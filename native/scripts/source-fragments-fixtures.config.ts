import {resolve} from 'node:path'
import {defineConfig} from 'vitest/config'
export default defineConfig({resolve:{alias:{'@main':resolve('src/main')}},test:{include:['native/scripts/source-fragments-fixtures.test.ts'],environment:'node'}})
