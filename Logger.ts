export class Logger {
	private enabled: () => boolean;

	constructor(enabled: () => boolean) {
		this.enabled = enabled;
	}

	log(message?: any, ...optionalParams: any[]): void {
		if (this.enabled()) {
			console.log(message, optionalParams);
		}
	}

	error(message?: any, ...optionalParams: any[]): void {
		if (this.enabled()) {
			console.error(message, optionalParams);
		}
	}
    
    assert(value: any, message?: string, ...optionalParams: any[]) {
        if (this.enabled()) {
            console.assert(value, message, optionalParams);
        }
    }
}
