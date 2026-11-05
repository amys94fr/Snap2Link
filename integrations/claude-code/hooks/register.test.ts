import { expect, test } from 'claude-code/testing'

const LINK = 'https://drive.google.com/uc?id=abc_123&export=download'
const OTHER = 'https://drive.google.com/uc?id=def_456&export=download'
const RELAY = 'https://i.snap2link.app/4fGh2kLm9PqRs7TuVw1XyZ'

function engine(on: Parameters<Parameters<typeof test>[1]>[1]) {
  const seen = { toasts: [] as string[], context: undefined as readonly string[] | undefined }
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_, e) => {
    seen.context = e.context
    return { text: e.text }
  })
  return seen
}

test('a Snap2Link link adds a note and a toast', async ($, on) => {
  const seen = engine(on)

  await $.prompt.submit({ text: `look at this ${LINK}` })

  expect(seen.toasts).toEqual(['Snap2Link capture detected'])
  expect(seen.context?.[0]).toContain(LINK)
  expect(seen.context?.[0]).toContain('read_capture')
})

test('the same link twice counts once, two links are both named', async ($, on) => {
  const seen = engine(on)

  await $.prompt.submit({ text: `${LINK} ${LINK} ${OTHER}` })

  expect(seen.toasts).toEqual(['2 Snap2Link captures detected'])
  expect(seen.context?.[0]).toContain(OTHER)
})

test('an older relay link keeps its .png', async ($, on) => {
  const seen = engine(on)

  await $.prompt.submit({ text: `look at ${RELAY}.png please` })

  expect(seen.context?.[0]).toContain(`${RELAY}.png`)
})

test('a prompt without a link is left alone', async ($, on) => {
  const seen = engine(on)

  await $.prompt.submit({ text: 'https://drive.google.com/file/d/abc/view and some text' })

  expect(seen.toasts).toEqual([])
  expect(seen.context).toBe(undefined)
})

test('a relay link is detected too', async ($, on) => {
  const seen = engine(on)

  await $.prompt.submit({ text: `look at ${RELAY} please` })

  expect(seen.toasts).toEqual(['Snap2Link capture detected'])
  expect(seen.context?.[0]).toContain(RELAY)
})
