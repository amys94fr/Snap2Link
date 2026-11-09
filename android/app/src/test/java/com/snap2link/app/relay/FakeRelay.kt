package com.snap2link.app.relay

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress

/** A local stand-in for the relay: answers queued in order, requests recorded. */
class FakeRelay : AutoCloseable {
    data class Request(val method: String, val path: String, val authorization: String?, val contentType: String?, val body: ByteArray)

    private class Answer(val status: Int, val body: String)

    private val answers = ArrayDeque<Answer>()
    val requests = mutableListOf<Request>()

    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/") { exchange ->
            requests += Request(
                exchange.requestMethod,
                exchange.requestURI.rawPath,
                exchange.requestHeaders.getFirst("Authorization"),
                exchange.requestHeaders.getFirst("Content-Type"),
                exchange.requestBody.readBytes(),
            )
            val answer = synchronized(answers) { answers.removeFirstOrNull() } ?: Answer(500, "")
            val bytes = answer.body.toByteArray()
            exchange.sendResponseHeaders(answer.status, if (bytes.isEmpty()) -1 else bytes.size.toLong())
            if (bytes.isNotEmpty()) exchange.responseBody.use { it.write(bytes) }
            exchange.close()
        }
        start()
    }

    val base = "http://127.0.0.1:${server.address.port}"

    fun answer(status: Int, body: String = "") {
        synchronized(answers) { answers.addLast(Answer(status, body)) }
    }

    override fun close() = server.stop(0)
}

class MemoryTokens(
    override var guest: String? = null,
    override var session: String? = null,
    override var email: String? = null,
) : TokenStore
