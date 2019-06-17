const path = require('path')
const fs = require('fs')
const chokidar = require('chokidar')
const Async = require('crocks/Async')
const { watchingDirs, eventNotification } = require('./messages')
const { build } = require('./build')
const { sendMessage, sendCompilingMessage } = require('./start')
const { inArray, debounce, update } = require('./utils')

/*
|-------------------------------------------------------------------------------
| Helpers
|-------------------------------------------------------------------------------
*/
const eventNameMap = {
  add: 'added',
  addDir: 'added',
  change: 'changed',
  unlink: 'removed',
  unlinkDir: 'removed'
}
const packageFileNames = ['elm.json', 'elm-package.json']
const isPackageFilePath = inArray(packageFileNames)
const defaultElmDirs = ['**/*.elm']

/*
|-------------------------------------------------------------------------------
| Getting Elm Sources
|-------------------------------------------------------------------------------
*/

/**
 * getSources_ :: String -> [ String ]
 *
 * This function takes in the path to the elm package file and pulls out all the source directories. If it fails to parse the elm package file it just returns the default dirs.
 **/
function getSources_ (packageFilePath) {
  try {
    const sourceDirs = JSON.parse(fs.readFileSync(packageFilePath))['source-directories']
    if (sourceDirs !== undefined) {
      return sourceDirs.map(dir => path.join(dir, '/**/*.elm'))
    } else {
      return defaultElmDirs
    }
  } catch (e) {
    // Do nothing about the exception (in parsing JSON) because the Elm compiler
    // will also parse the file and report the error - and elm-live will show it
    // to the user. We don't want to report the same error twice.
    return defaultElmDirs
  }
}

/**
 * getSources :: String -> [ String ]
 *
 * This function takes in the working directory and tries the two different elm package file paths. If it fails to parse the elm package files it just returns the default dirs.
 **/
function getSources (workPath = process.cwd()) {
  const elmJsonPath = path.join(workPath, 'elm.json')
  const elmPackageJsonPath = path.join(workPath, 'elm-package.json')

  if (fs.existsSync(elmJsonPath)) {
    return getSources_(elmJsonPath)
  } else if (fs.existsSync(elmPackageJsonPath)) {
    return getSources_(elmPackageJsonPath)
  } else {
    return defaultElmDirs
  }
}

/*
|-------------------------------------------------------------------------------
| Watcher
|-------------------------------------------------------------------------------
*/

/**
 * watch :: Model -> Async Error Never
 *
 * This function takes in the Model and then asynchronously starts the watcher for all elm files in the project. It only ever resolves on an error since if everything is successful it should watch forever.
 **/
const watch = model => Async((reject, _) => {
  const sources = getSources()

  model.log(watchingDirs(sources))

  const watcher = chokidar.watch([...sources, ...packageFileNames], {
    ignoreInitial: true,
    followSymlinks: false,
    ignored: 'elm-stuff/generated-code/*'
  })

  watcher.on(
    'all',
    debounce((event, filePath) => {
      const relativePath = path.relative(process.cwd(), filePath)
      const eventName = eventNameMap[event] || event
      const eventMsg = eventNotification(eventName, relativePath)
      model.log(eventMsg)

      if (isPackageFilePath(relativePath)) {
        // Package file changes may result in changes to the set
        // of watched files
        watcher.close()
        watch(model)
      }

      function closeAndReject (x) {
        watcher.close()
        reject(x)
      }

      if (model.notify) {
        sendCompilingMessage(eventMsg)(model)
      }

      build(model)
        .map(build => update(model, { build }))
        .map(sendMessage)
        .fork(closeAndReject, watch)
    }),
    100
  )
})

module.exports = {
  watch
}