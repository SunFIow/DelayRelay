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

	debug(...messages) {
		this.log('DEBUG', ...messages);
	}

	info(...messages) {
		this.log('INFO', ...messages);
	}

	warn(...messages) {
		this.log('WARN', ...messages);
	}

	error(...messages) {
		this.log('ERROR', ...messages);
	}

	fatal(...messages) {
		this.log('FATAL', ...messages);
	}

	log(level, ...messages) {
		const timestamp = this.getTimeString();
		const prefix = `[${timestamp}] [${level}]`;
		let message = '';
		for (let i = 0; i < messages.length; i++) {
			if (typeof messages[i] === 'string') message += messages[i];
			else message += JSON.stringify(messages[i], null, 3);

			if (i < messages.length - 1) message += ' '; // Add space between messages
		}
		this.logStream.write(`${prefix} ${message}\n`);
		if (level !== 'TRACE' && level !== 'DEBUG') {
			this.logLatestStream.write(`${prefix} ${message}\n`);
			console.log(prefix, ...messages);
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
