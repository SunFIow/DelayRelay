const prom = new Promise((resolve, reject) => {
	// Simulate async operation
	resolve('Operation successful');
	// reject('Operation failed');
});

try {
	const result = await prom;
	console.log(result);
} catch (error) {
	console.error('err:', error);
}
