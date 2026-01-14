#!/usr/bin/env -S node --loader ts-node/esm --disable-warning=ExperimentalWarning

// eslint-disable-next-line n/no-unpublished-import -- Development script imports from src
import { executeCLI } from '../src/cli.js';

await executeCLI({ development: true, dir: import.meta.url });
