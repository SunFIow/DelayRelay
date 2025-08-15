import fs from 'fs';
import { getFilePath } from './utils.js';

export class Logger {
	constructor(prefix) {
		const d = new Date();
		const pad = n => n.toString().padStart(2, '0');
		const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}__${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
		this.logFile = getFilePath(`logs/${prefix}_${ts}.log`);
		this.logLatest = getFilePath(`${prefix}_latest.log`);
		// Crate logs directory if it doesn't exist
		const logDir = getFilePath('logs');
		if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
		// Truncate latest log files at startup
		fs.writeFileSync(this.logLatest, '');
		this.logStream = fs.createWriteStream(this.logFile, { flags: 'a' });
		this.logLatestStream = fs.createWriteStream(this.logLatest, { flags: 'a' });
	}

	trace(...message) {
		this.log('TRACE', ...message);
	}

	debug(...message) {
		this.log('DEBUG', ...message);
	}

	info(...message) {
		this.log('INFO', ...message);
	}

	warn(...message) {
		this.log('WARN', ...message);
	}

	error(...message) {
		this.log('ERROR', ...message);
	}

	fatal(...message) {
		this.log('FATAL', ...message);
	}

	log(level, ...message) {
		const timestamp = this.getTimeString();
		const line = `[${timestamp}] [${level}] ${message.join(' ')}`;
		this.logStream.write(line + '\n');
		if (level !== 'TRACE' && level !== 'DEBUG') {
			this.logLatestStream.write(line + '\n');
			console.log(line);
		}
	}

	getTimeString() {
		const d = new Date();
		const pad = n => n.toString().padStart(2, '0');
		return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	}
}

export const LOGGER = new Logger('relay');
export const LOGGER_API = new Logger('api');
