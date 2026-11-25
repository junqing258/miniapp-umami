const fs = require('node:fs');

fs.writeFileSync('lib/package.json', `${JSON.stringify({ type: 'commonjs' })  }\n`);
