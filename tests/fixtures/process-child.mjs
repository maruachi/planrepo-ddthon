const modes = new Set([
  'success',
  'late-stderr-overflow',
  'flood-both',
  'wait-for-term',
  'ignore-term',
  'nonzero',
  'invalid-json',
]);

const mode = process.argv[2];
if (!modes.has(mode)) {
  process.exitCode = 64;
} else {
  await run(mode);
}

async function run(selectedMode) {
  const input = await readInput();
  switch (selectedMode) {
    case 'success':
      await write(process.stdout, input);
      return;
    case 'late-stderr-overflow':
      await end(process.stdout, Buffer.from('stdout-complete'));
      await write(process.stderr, Buffer.alloc(262_145, 0x65));
      return;
    case 'flood-both':
      await Promise.all([
        write(process.stdout, Buffer.alloc(4_194_304, 0x6f)),
        write(process.stderr, Buffer.alloc(262_144, 0x65)),
      ]);
      return;
    case 'wait-for-term':
      await waitForSignal(false);
      return;
    case 'ignore-term':
      await waitForSignal(true);
      return;
    case 'nonzero':
      await write(process.stderr, Buffer.from('fixture nonzero'));
      process.exitCode = 7;
      return;
    case 'invalid-json':
      await write(process.stdout, Buffer.from('not-json'));
  }
}

function readInput() {
  return new Promise((resolveInput, rejectInput) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.once('end', () => resolveInput(Buffer.concat(chunks)));
    process.stdin.once('error', rejectInput);
  });
}

function write(stream, bytes) {
  return new Promise((resolveWrite, rejectWrite) => {
    stream.write(bytes, (error) => {
      if (error) rejectWrite(error);
      else resolveWrite();
    });
  });
}

function end(stream, bytes) {
  return new Promise((resolveEnd) => stream.end(bytes, resolveEnd));
}

function waitForSignal(ignoreTerm) {
  return new Promise(() => {
    process.on('SIGTERM', () => {
      if (!ignoreTerm) process.exit(0);
    });
    setInterval(() => undefined, 1_000);
  });
}
