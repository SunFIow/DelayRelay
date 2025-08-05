import nodeResolve from '@rollup/plugin-node-resolve';
import copy from 'rollup-plugin-copy';

export default {
	input: 'src/index.js',
	output: {
		file: 'dist/delayrelay.js',
		format: 'cjs'
	},
	plugins: [
		nodeResolve({
			modulesOnly: true
		}),
		copy({
			targets: [
				{ src: 'src/**/*.json', dest: 'dist' },
				{ src: 'src/**/*.html', dest: 'dist' },
				{ src: 'src/**/*.css', dest: 'dist' }
			]
		})
	]
};
