const fs = require('fs');

fs.writeFileSync(
  'proof-of-execution.txt',
  [
    'attacker-controlled fix script executed',
    `cwd=${process.cwd()}`,
  ].join('\n') + '\n',
);

console.log('attacker-controlled fix script executed');
