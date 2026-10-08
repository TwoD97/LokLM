// No model/library import. This worker only exercises the actual Electron IPC shape.
process.parentPort.on('message', (event) => {
  const message = event.data ?? event
  process.parentPort.postMessage({
    id: message.id,
    ok: true,
    result: {
      forwarded: message.payload?.probe === 'preserve-me',
      raw: JSON.stringify({
        check: 'PRIVATE_CHECK',
        result: {
          resolution: 'answered',
          blocks: [{ text: 'PRIVATE_ANSWER', evidence: ['Synthetic fixture evidence.'] }],
        },
      }),
    },
  })
})
