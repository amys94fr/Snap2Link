import type { Register } from 'claude-code'

const SHARE_LINK = /https:\/\/drive\.google\.com\/uc\?id=[A-Za-z0-9_-]{1,128}&export=download|https:\/\/i\.snap2link\.app\/[0-9A-Za-z]{22}\.png/g

export const register: Register = (on) => {
  on('prompt.submit', ($, e, next) => {
    const links = [...new Set(e.text.match(SHARE_LINK) ?? [])]
    if (e.command || links.length === 0) return next(e)

    $.ui.toast(links.length === 1 ? 'Snap2Link capture detected' : `${links.length} Snap2Link captures detected`)

    const note = `The prompt contains Snap2Link screenshot links. Read each one with the read_capture tool of the snap2link MCP server before answering: ${links.join(' ')}`
    return next({ ...e, context: [...(e.context ?? []), note] })
  })
}
