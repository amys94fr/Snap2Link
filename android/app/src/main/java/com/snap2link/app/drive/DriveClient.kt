package com.snap2link.app.drive

import com.snap2link.app.relay.Link
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Google Drive, as the desktop app uses it: captures go to a "Snap2Link"
 * folder, each one public for whoever has its link. With the `drive.file`
 * permission the app only ever sees the files it created.
 */
class DriveClient(
    private val api: String = "https://www.googleapis.com",
) {
    /** The folder's id: [known] when it still exists, else found or created. */
    suspend fun folder(token: String, known: String?): String {
        if (known != null && isDriveId(known)) {
            val found = try {
                JSONObject(call("GET", "/drive/v3/files/$known?fields=id,trashed", token))
            } catch (e: DriveException) {
                if (e.code != NOT_FOUND) throw e
                null
            }
            if (found != null && !found.optBoolean("trashed")) return known
        }
        val query = "name='$FOLDER_NAME' and mimeType='$FOLDER_TYPE' and trashed=false"
        val list = JSONObject(call("GET", "/drive/v3/files?${params("q" to query, "fields" to "files(id)", "pageSize" to "1")}", token))
        list.optJSONArray("files")?.optJSONObject(0)?.optString("id")?.takeIf(::isDriveId)?.let { return it }

        val body = JSONObject().put("name", FOLDER_NAME).put("mimeType", FOLDER_TYPE)
        val created = JSONObject(call("POST", "/drive/v3/files?fields=id", token, json = body))
        return created.optString("id").takeIf(::isDriveId) ?: throw DriveException(INVALID_RESPONSE)
    }

    /** Sends a PNG to [folder], makes it public, and returns its link. */
    suspend fun upload(token: String, folder: String, png: ByteArray, now: Instant = Instant.now()): Link {
        val boundary = "snap2link-${now.toEpochMilli()}"
        val metadata = JSONObject().put("name", fileName(now)).put("parents", JSONArray().put(folder))
        val body = buildList {
            add("--$boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n$metadata\r\n".toByteArray())
            add("--$boundary\r\nContent-Type: image/png\r\n\r\n".toByteArray())
            add(png)
            add("\r\n--$boundary--\r\n".toByteArray())
        }.reduce(ByteArray::plus)
        val answer = call(
            "POST",
            "/upload/drive/v3/files?uploadType=multipart&fields=id,createdTime",
            token,
            bytes = body,
            contentType = "multipart/related; boundary=$boundary",
        )
        val file = JSONObject(answer)
        val id = file.optString("id").takeIf(::isDriveId) ?: throw DriveException(INVALID_RESPONSE)
        // Anyone with the link can see it; the rest of the Drive stays private.
        call("POST", "/drive/v3/files/$id/permissions", token, json = JSONObject().put("type", "anyone").put("role", "reader"))
        return Link(id, linkFor(id), now, expiresAt = null, pinned = false)
    }

    /** The newest captures of [folder], with their end when the cleanup is on. */
    suspend fun history(token: String, folder: String, retentionDays: Int?): List<Link> {
        val query = "'$folder' in parents and trashed=false"
        val answer = call(
            "GET",
            "/drive/v3/files?${params(
                "q" to query,
                "orderBy" to "createdTime desc",
                "fields" to "files(id,createdTime,thumbnailLink,appProperties)",
                "pageSize" to HISTORY_SIZE,
            )}",
            token,
        )
        return try {
            val files = JSONObject(answer).optJSONArray("files") ?: JSONArray()
            (0 until files.length()).mapNotNull { linkFrom(files.getJSONObject(it), retentionDays) }
        } catch (_: JSONException) {
            throw DriveException(INVALID_RESPONSE)
        }
    }

    /** Kept captures are marked in their `appProperties`, as on the desktop. */
    suspend fun setKept(token: String, id: String, kept: Boolean) {
        requireId(id)
        val value: Any = if (kept) "1" else JSONObject.NULL
        call("PATCH", "/drive/v3/files/$id", token, json = JSONObject().put("appProperties", JSONObject().put(KEEP_KEY, value)))
    }

    suspend fun delete(token: String, id: String) {
        requireId(id)
        call("DELETE", "/drive/v3/files/$id", token)
    }

    /** Deletes the captures older than [days], kept ones aside. Returns how many went. */
    suspend fun cleanup(token: String, folder: String, days: Int, now: Instant = Instant.now()): Int {
        val query = "'$folder' in parents and createdTime < '${cutoff(now, days)}' and trashed=false " +
            "and not appProperties has { key='$KEEP_KEY' and value='1' }"
        var deleted = 0
        var page: String? = null
        do {
            val pairs = mutableListOf("q" to query, "fields" to "nextPageToken,files(id)", "pageSize" to "100")
            page?.let { pairs += "pageToken" to it }
            val answer = JSONObject(call("GET", "/drive/v3/files?${params(*pairs.toTypedArray())}", token))
            val files = answer.optJSONArray("files") ?: JSONArray()
            for (i in 0 until files.length()) {
                val id = files.getJSONObject(i).optString("id")
                if (!isDriveId(id)) continue
                try {
                    call("DELETE", "/drive/v3/files/$id", token)
                    deleted++
                } catch (e: DriveException) {
                    if (e.code == UNAUTHORIZED) throw e
                }
            }
            page = answer.optString("nextPageToken").ifEmpty { null }
        } while (page != null)
        return deleted
    }

    /** The address of the Google account the token belongs to. */
    suspend fun email(token: String): String {
        val answer = JSONObject(call("GET", "/oauth2/v3/userinfo", token))
        return answer.optString("email").ifEmpty { throw DriveException(INVALID_RESPONSE) }
    }

    private suspend fun call(
        method: String,
        path: String,
        token: String,
        json: JSONObject? = null,
        bytes: ByteArray? = null,
        contentType: String? = null,
    ): String = withContext(Dispatchers.IO) {
        val connection = try {
            URL(api + path).openConnection() as HttpURLConnection
        } catch (_: IOException) {
            throw DriveException(UNREACHABLE)
        }
        try {
            // HttpURLConnection has no PATCH: Google takes the override header.
            if (method == "PATCH") {
                connection.requestMethod = "POST"
                connection.setRequestProperty("X-HTTP-Method-Override", "PATCH")
            } else {
                connection.requestMethod = method
            }
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Authorization", "Bearer $token")
            val payload = json?.toString()?.toByteArray() ?: bytes
            if (payload != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", contentType ?: "application/json; charset=UTF-8")
                connection.setFixedLengthStreamingMode(payload.size)
                connection.outputStream.use { it.write(payload) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.use { it.readBytes().decodeToString() }.orEmpty()
            when {
                status in 200..299 -> text
                status == 401 -> throw DriveException(UNAUTHORIZED)
                status == 404 -> throw DriveException(NOT_FOUND)
                status == 403 && "storageQuotaExceeded" in text -> throw DriveException(QUOTA)
                else -> throw DriveException(FAILED)
            }
        } catch (e: DriveException) {
            throw e
        } catch (_: IOException) {
            throw DriveException(UNREACHABLE)
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        const val FOLDER_NAME = "Snap2Link"
        private const val FOLDER_TYPE = "application/vnd.google-apps.folder"
        private const val KEEP_KEY = "snap2link_keep"
        private const val HISTORY_SIZE = "100"
        private const val TIMEOUT_MS = 30_000

        const val UNAUTHORIZED = "unauthorized"
        const val NOT_FOUND = "not_found"
        const val QUOTA = "quota"
        const val FAILED = "failed"
        const val UNREACHABLE = "unreachable"
        const val INVALID_RESPONSE = "invalid_response"

        /** The desktop's link: it opens for anyone, signed in to Google or not. */
        fun linkFor(id: String) = "https://drive.google.com/uc?id=$id&export=download"

        /** Drive ids go into paths and queries, so they have to look like ids. */
        fun isDriveId(id: String): Boolean =
            id.isNotEmpty() && id.length <= 128 && id.all { it.isLetterOrDigit() && it.code < 128 || it == '-' || it == '_' }

        fun fileName(at: Instant): String =
            "screenshot_${NAME_FORMAT.format(at)}.png"

        fun cutoff(now: Instant, days: Int): String = CUTOFF_FORMAT.format(now.minus(Duration.ofDays(days.toLong())))

        fun linkFrom(file: JSONObject, retentionDays: Int?): Link? {
            val id = file.optString("id").takeIf(::isDriveId) ?: return null
            val created = try {
                Instant.parse(file.optString("createdTime"))
            } catch (_: Exception) {
                return null
            }
            val kept = file.optJSONObject("appProperties")?.optString(KEEP_KEY) == "1"
            val expires = retentionDays?.takeIf { !kept }?.let { created.plus(Duration.ofDays(it.toLong())) }
            val thumbnail = file.optString("thumbnailLink").takeIf { it.startsWith("https://") }
            return Link(id, linkFor(id), created, expires, kept, thumbnail)
        }

        private fun requireId(id: String) {
            if (!isDriveId(id)) throw DriveException(INVALID_RESPONSE)
        }

        private fun params(vararg pairs: Pair<String, String>): String =
            pairs.joinToString("&") { (key, value) -> "$key=${URLEncoder.encode(value, "UTF-8").replace("+", "%20")}" }

        private val NAME_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss").withZone(ZoneOffset.UTC)
        private val CUTOFF_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss").withZone(ZoneOffset.UTC)
    }
}

class DriveException(val code: String) : Exception(code)
