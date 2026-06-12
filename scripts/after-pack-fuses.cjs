// electron-builder afterPack hook : flip the Electron fuses on the packaged
// binary. Fuses are build-time switches burned into the executable — without
// this step anyone can relaunch the installed app with ELECTRON_RUN_AS_NODE=1
// ( instant arbitrary Node code in our process , reading the unlocked DEK ) or
// attach a debugger via --inspect and dump memory. Flipping them here covers
// win + linux + mac alike , since all three package flows go through
// electron-builder ( see package:win:payload / build-mac-payloads.mjs ).
//
// CJS on purpose : electron-builder require()s hook files , and the repo is
// "type": "module" , so this needs the .cjs extension.
//
// Not flipped ( deliberate ) :
//   - EnableEmbeddedAsarIntegrityValidation : needs builder-generated
//     integrity payloads ; enabling it without them bricks the app at boot ,
//     and linux doesn't support it at all. Revisit with code signing.
//   - GrantFileProtocolExtraPrivileges : the renderer is loaded via loadFile
//     and pdfjs spawns its worker from a file:// URL — removing the
//     privileges breaks both.
'use strict'

const path = require('node:path')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

function executablePath(context) {
  const { appOutDir, packager, electronPlatformName } = context
  const product = packager.appInfo.productFilename
  switch (electronPlatformName) {
    case 'win32':
      return path.join(appOutDir, `${product}.exe`)
    case 'darwin':
    case 'mas':
      return path.join(appOutDir, `${product}.app`, 'Contents', 'MacOS', product)
    default:
      // linux : config sets executableName ( 'loklm' ) , exposed on the packager.
      return path.join(appOutDir, packager.executableName ?? product)
  }
}

exports.default = async function afterPack(context) {
  const exe = executablePath(context)
  await flipFuses(exe, {
    version: FuseVersion.V1,
    // Flipping bytes in the binary invalidates the mac ad-hoc signature that
    // arm64 requires to even launch ; re-sign ad-hoc in place ( the build is
    // otherwise unsigned , identity: null ).
    resetAdHocDarwinSignature: context.electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  })
  console.log(`  • flipped electron fuses  exe=${exe}`)
}
