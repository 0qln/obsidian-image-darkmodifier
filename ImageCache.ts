import * as crypto from 'crypto';
import * as fs from 'fs';
import { Logger } from 'Logger';
import { TFile } from 'obsidian';
import * as path from 'path';

export class ImageCache {
	private cacheDir: string;
	private vaultPath: string;
	private logger: Logger;

	constructor(vaultPath: string, cacheDir: string, logger: Logger) {
		this.cacheDir = cacheDir;
		this.vaultPath = vaultPath;
		this.ensureCacheDir();
		this.logger = logger;
	}

	absoluteCacheDir(): string {
		return path.join(this.vaultPath, this.cacheDir);
	}

	private ensureCacheDir() {
		const dir = this.absoluteCacheDir();
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
	}

	setCacheDir(newPath: string) {
		this.cacheDir = newPath;
		this.ensureCacheDir();
	}

	private getSafeHash(filePath: string, length = 12): string {
		return crypto
			.createHash('sha256')
			.update(filePath)
			.digest('hex')
			.substring(0, length);
	}

	cacheName(file: ImageInfo, filterNames: Array<string>): string {
		const hash = this.getSafeHash(file.path);
		const name = file.basename.replace(/[^a-zA-Z0-9_-]/g, '_');
		return `${name}_${hash}_${filterNames.join('_')}.png`;
	}

	cachePath(file: ImageInfo, filternames: Array<string>): string {
		return path.join(this.cacheDir, this.cacheName(file, filternames));
	}

	absoluteCachePath(file: ImageInfo, filternames: Array<string>): string {
		return path.join(this.vaultPath, this.cachePath(file, filternames));
	}

	isFresh(file: ImageInfo, filterNames: string[]): boolean {
		const cachePath = this.absoluteCachePath(file, filterNames);
		try {
			if (!fs.existsSync(cachePath)) return false;

			const cacheStat = fs.statSync(cachePath);
			return cacheStat.mtimeMs >= file.stat.mtime;
		} catch {
			return false;
		}
	}

	clear(file: ImageInfo, filterNames: string[]) {
		const cachePath = this.absoluteCachePath(file, filterNames);

		this.logger.log('[  CACHE  ]   clear: ', cachePath);

		try {
			if (fs.existsSync(cachePath)) {
				fs.unlinkSync(cachePath);
			}
		} catch (error) {
			this.logger.error('[  CACHE  ]   failed to clear cache:', error);
		}
	}

	clearAllForFile(file: ImageInfo) {
		this.logger.log('[  CACHE  ]   clear all: ', file.name);

		try {
			const cacheDir = this.absoluteCacheDir();
			const files = fs.readdirSync(cacheDir);
			const fileHash = this.getSafeHash(file.path);

			files.forEach(filename => {
				if (filename.includes(fileHash)) {
					const filePath = path.join(cacheDir, filename);
					fs.unlinkSync(filePath);

					this.logger.log('[  CACHE  ]   * clear: ', filePath);
				}
			});
		} catch (error) {
			this.logger.error('[  CACHE  ]   failed to clear cache for file:', error);
		}
	}

	clearEntireCache() {
		const cacheDir = this.absoluteCacheDir();

		this.logger.log('[  CACHE  ]   clear entire cache: ', cacheDir);

		try {
			const files = fs.readdirSync(cacheDir);
			files.forEach(filename => {
				const filePath = path.join(cacheDir, filename);
				if (fs.existsSync(filePath)) {
					fs.unlinkSync(filePath);

					this.logger.log('[  CACHE  ]   * clear: ', filePath);
				}
			});
		} catch (error) {
			this.logger.error('[  CACHE  ]   failed to clear cache:', error);
		}
	}
}

export interface ImageInfo {
	path: string;
	basename: string;
	name: string;
	stat: { mtime: number };
}

export class RemoteImageInfo implements ImageInfo {
	path: string;

	basename: string;

	name: string;

	// don't assume any modification times about remote files.
	stat: { mtime: number; } = { mtime: Number.MAX_VALUE };
}

export class LocalImageInfo extends TFile implements ImageInfo {
	// TFile implements everything we need
}