const fs = require('fs');
const path = require('path');

const files = [
  path.join('src', 'remote', 'localConfig.json'),
  path.join('scripts', 'aga-remote-config.example.json'),
];

let failed = false;
for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(`Missing ${file}`);
    failed = true;
    continue;
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data.revision) throw new Error('missing revision');
    if (!Array.isArray(data.skills)) throw new Error('skills must be an array');
    for (const skill of data.skills) {
      if (!skill.id || !skill.label || !skill.instructions) {
        throw new Error(`invalid skill ${JSON.stringify(skill).slice(0, 160)}`);
      }
    }
    if (data.tools && !Array.isArray(data.tools)) throw new Error('tools must be an array');
    console.log(`✓ ${file} revision=${data.revision} skills=${data.skills.length} tools=${data.tools?.length ?? 0}`);
  } catch (error) {
    console.error(`Invalid ${file}: ${error.message}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('AGA remote/local config files are valid JSON.');
