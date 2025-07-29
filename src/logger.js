import fs from 'fs';

export class Logger {
	constructor(prefix) {
		const d = new Date();
		const pad = n => n.toString().padStart(2, '0');
		const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}__${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
		this.logFile = `logs/${prefix}_${ts}.log`;
		this.logLatest = `logs/relay_latest.log`;
		// Truncate latest log files at startup
		fs.writeFileSync(this.logLatest, '');
		this.logStream = fs.createWriteStream(this.logFile, { flags: 'a' });
		this.logLatestStream = fs.createWriteStream(this.logLatest, { flags: 'a' });
	}

	debug(message) {
		this.log('DEBUG', message);
	}

	info(message) {
		this.log('INFO', message);
	}

	warn(message) {
		this.log('WARN', message);
	}

	error(message) {
		this.log('ERROR', message);
	}

	fatal(message) {
		this.log('FATAL', message);
	}

	log(level, message) {
		const timestamp = this.getTimeString();
		const line = `[${timestamp}] [${level}] ${message}`;
		this.logStream.write(line + '\n');
		if (level !== 'DEBUG') {
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
