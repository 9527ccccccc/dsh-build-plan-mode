import { cp, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { ALL_LIB_FILES } from './lib-roster.mjs'
import { profilePackageDirectory } from './profile-identity.mjs'

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
// Install identity has one owner: the package manifest. Renaming the
// package therefore moves the deployment destination with it.
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const profilePackage = profilePackageDirectory(manifest.name, dshHome)
const packageRoot = new URL('../', import.meta.url)

await mkdir(join(profilePackage, 'lib'), { recursive: true })
await cp(new URL('../package.json', import.meta.url), join(profilePackage, 'package.json'))
for (const name of ALL_LIB_FILES) {
  await cp(new URL(`../lib/${name}`, import.meta.url), join(profilePackage, 'lib', name))
}
console.log(`deployed ${packageRoot.pathname} to ${profilePackage}`)
console.log('verify exactly one root build-plan-mode row with: dsh web --dump-config')
