const fs = require('fs');
const path = require('path');

const BASE_DIR = path.resolve(__dirname, '../../local-data');

function resolvePath(filePath) {
  return path.join(BASE_DIR, filePath);
}

const localFilesLib = {
  async write(filePath, content) {
    const fullPath = resolvePath(filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  },

  async read(filePath) {
    return fs.readFileSync(resolvePath(filePath));
  },

  async delete(filePath) {
    const fullPath = resolvePath(filePath);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  },

  async list(prefix) {
    const fullPath = resolvePath(prefix);
    if (!fs.existsSync(fullPath)) return [];
    return fs.readdirSync(fullPath).map((name) => ({ name: path.join(prefix, name) }));
  },
};

module.exports = { localFilesLib };
