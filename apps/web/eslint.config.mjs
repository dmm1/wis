import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import root from '../../eslint.config.mjs';

const config = [...root, ...nextVitals, ...nextTs];
export default config;
