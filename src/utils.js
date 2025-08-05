import path from 'path';
import url from 'url';

const FILENAME = url.fileURLToPath(import.meta.url);
const DIRNAME = path.dirname(FILENAME);
const workingDirectory = process.cwd();

export function getFilePath(filename, vm = false) {
	if (vm) {
		return path.join(DIRNAME, filename);
	}
	return path.join(workingDirectory, filename);
}
