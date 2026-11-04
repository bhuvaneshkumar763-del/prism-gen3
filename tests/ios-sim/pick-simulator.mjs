#!/usr/bin/env node
// Prints the UDID of an iPhone simulator on the newest installed iOS runtime.
//   xcrun simctl list devices available -j | node tests/ios-sim/pick-simulator.mjs

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  const { devices } = JSON.parse(input);
  const runtimes = Object.keys(devices)
    .filter((r) => r.includes('iOS'))
    .sort((a, b) => {
      const v = (r) => (r.match(/iOS-(\d+)-(\d+)/) ?? [0, 0, 0]).slice(1).map(Number);
      const [a1, a2] = v(a);
      const [b1, b2] = v(b);
      return b1 - a1 || b2 - a2;
    });
  for (const runtime of runtimes) {
    const phones = devices[runtime].filter((d) => d.isAvailable && /^iPhone \d+( Pro)?$/.test(d.name));
    const phone = phones.at(-1) ?? devices[runtime].find((d) => d.isAvailable && d.name.startsWith('iPhone'));
    if (phone) {
      console.log(`${phone.udid} ${phone.name} (${runtime.split('.').pop()})`);
      return;
    }
  }
  console.error('No iPhone simulator found');
  process.exit(1);
});
