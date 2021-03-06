import fs from 'fs'
import path from 'path'
import { exec as execCb } from 'child_process'
import { promisify } from 'util'

import streamToPromise from 'stream-to-promise'
import gulp from 'gulp'
import addsrc from 'gulp-add-src'
import clipEmptyFiles from 'gulp-clip-empty-files'
import concatCss from 'gulp-concat-css'
import identity from 'gulp-identity'
import indefinitely from 'indefinitely'
import source from 'vinyl-source-stream'
import buffer from 'vinyl-buffer'
import eslint from 'gulp-eslint'
import stylelint from 'gulp-stylelint'
import browserify from 'browserify'
import watchify from 'watchify'
import babelify from 'babelify'
import envify from 'loose-envify/custom'
import cssModulesify from 'css-modulesify'
import postcssPresetEnv from 'postcss-preset-env'
import terser from 'gulp-terser'
import markdownToHtml from '@wulechuan/gulp-markdown-to-html'

const exec = promisify((command, callback) => {
    // Let exec also display the shell command and its output
    console.log('>>>', command)
    execCb(command, (error, stdout, stderr) => {
        console.log(stdout)
        console.error(stderr)
        callback(error, stdout, stderr)
    })
})


// === Tasks for building the source code; result is put into ./extension ===

const staticFiles = {
    'src/manifest.json': 'extension',
    'src/*.html': 'extension',
    'src/assets/**': 'extension/assets/',
    'node_modules/webextension-polyfill/dist/browser-polyfill.js': 'extension/lib',
    'node_modules/semantic-ui-css/semantic.min.css': 'extension/lib/semantic-ui',
    'node_modules/semantic-ui-css/themes/**/*': 'extension/lib/semantic-ui/themes',
}

const markdownFiles = {
    'Changelog.md': 'extension',
}

const sourceFiles = [
    'main/background.js',
    'main/content_script.js',
    'overview/overview.jsx',
    'local-page/local-page.jsx',
    'popup/popup.jsx',
    'options/options.jsx',
]

const browserifySettings = {
    debug: true,
    extensions: ['.jsx', '.css'],
    paths: ['.'],
}

// Define babel config here, as .babelrc is already used for converting this gulpfile itself.
const babelifySettings = {
    presets: [
        '@babel/preset-react',
        ['@babel/preset-env', {
            targets: {
                browsers: [
                    'last 2 Firefox versions',
                    'last 2 Chrome versions',
                ],
            },
        }],
    ],
}

const markdownToHtmlOptions = {
    conversionPreparations: {
        shouldNotAutoInsertTOCPlaceholderIntoMarkdown: true,
    },
    conversionOptions: {
        shouldNotBuildHeadingPermanentLinks: true,
    },
    manipulationsOverHTML: {
        htmlTagLanguage: 'en',
        shouldNotInsertBackToTopAnchor: true,
    },
}

async function createBundle({ filePath, watch = false, production = false }) {
    const { dir, name } = path.parse(filePath)
    const entries = [path.join('src', filePath)]
    const destination = path.join('extension', dir)
    const output = `${name}.js` // ignore original filename extension, to replace jsx with js.

    // Hard-code the inclusion of any css file with the same name as the script.
    // We append any css-modules imported from the script to this css file.
    const cssInputPath = path.join('src', dir, `${name}.css`)
    const cssOutput = `${name}.css`

    let b = watch
        ? watchify(browserify({ ...watchify.args, ...browserifySettings, entries }))
            .on('update', bundle)
        : browserify({ ...browserifySettings, entries })
    b.transform(babelify, babelifySettings)
    b.transform(envify({
        NODE_ENV: production ? 'production' : 'development',
    }), { global: true })

    b.plugin(cssModulesify, {
        global: true, // for importing css modules from e.g. react-datepicker.
        rootDir: path.join('src', dir),
        // output: path.join(destination, cssOutput), // We read the stream instead (see below)
        postcssBefore: [
            postcssPresetEnv({
                stage: 0,
            }),
        ],
    })
    b.on('css stream', stream => {
        // Append the css-modules output to the script's eponymous plain css file (if any).
        // TODO resolve & copy @import and url()s
        stream
            .pipe(source('css-modules-output.css')) // pretend the streamed data had this filename.
            .pipe(buffer()) // concatCss & clipEmptyFiles do not support streamed files.
            .pipe(fs.existsSync(cssInputPath) ? addsrc.prepend(cssInputPath) : identity())
            .pipe(concatCss(cssOutput, { inlineImports: false }))
            .pipe(clipEmptyFiles()) // Drop file if no output was produced (e.g. no background.css)
            .pipe(gulp.dest(destination))
    })

    function bundle(callback) {
        let startTime = Date.now()
        b.bundle()
            .on('error', error => console.error(error.message))
            .pipe(source(output))
            .pipe(buffer())
            .pipe(production ? terser({ output: { ascii_only: true } }) : identity())
            .pipe(gulp.dest(destination))
            .on('end', () => {
                let time = (Date.now() - startTime) / 1000
                console.log(`Bundled ${output} in ${time}s.`)
                if (!watch) {
                    callback()
                }
            })
    }

    await promisify(bundle)()
}

gulp.task('copyStaticFiles', async () => {
    for (let filename in staticFiles) {
        console.log(`Copying '${filename}' to '${staticFiles[filename]}'..`)
        gulp.src(filename)
            .pipe(gulp.dest(staticFiles[filename]))
    }
})

gulp.task('copyStaticFiles-watch', gulp.series('copyStaticFiles',
    async function watchAndCopyStaticFiles() {
        Object.entries(staticFiles).forEach(([filename, destination]) => {
            gulp.watch(filename)
                .on('all', (event, path) => {
                    console.log(`Copying '${filename}' to '${staticFiles[filename]}'..`)
                    return gulp.src(filename)
                        .pipe(gulp.dest(staticFiles[filename]))
                })
        })

        await indefinitely
    }
))

gulp.task('convertMarkdownFiles', async () => {
    for (let filename in markdownFiles) {
        console.log(`Converting '${filename}' to '${markdownFiles[filename]}'..`)
        gulp.src(filename)
            .pipe(markdownToHtml(markdownToHtmlOptions))
            .pipe(gulp.dest(markdownFiles[filename]))
    }
})

gulp.task('convertMarkdownFiles-watch', gulp.series('convertMarkdownFiles',
    async function watchAndConvertMarkdownFiles() {
        Object.entries(markdownFiles).forEach(([filename, destination]) => {
            gulp.watch(filename)
                .on('all', (event, path) => {
                    console.log(`Converting '${filename}' to '${markdownFiles[filename]}'..`)
                    return gulp.src(filename)
                        .pipe(markdownToHtml(markdownToHtmlOptions))
                        .pipe(gulp.dest(markdownFiles[filename]))
                })
        })

        await indefinitely
    }
))

gulp.task('build-prod', gulp.parallel('copyStaticFiles', 'convertMarkdownFiles', async function bundleForProduction() {
    const ps = sourceFiles.map(filePath => createBundle({ filePath, watch: false, production: true }))
    await Promise.all(ps)
}))

gulp.task('build', gulp.parallel('copyStaticFiles', 'convertMarkdownFiles',  async function bundleForDevelopment() {
    const ps = sourceFiles.map(filePath => createBundle({ filePath, watch: false }))
    await Promise.all(ps)
}))

gulp.task('build-watch', gulp.parallel('copyStaticFiles-watch', 'convertMarkdownFiles-watch', async function watchAndBundle() {
    const ps = sourceFiles.map(filePath => createBundle({ filePath, watch: true }))
    await Promise.all(ps)
}))


// === Tasks for linting the source code ===

const stylelintOptions = {
    failAfterError: false,
    reporters: [
        { formatter: 'string', console: true },
    ],
}

gulp.task('lint', async () => {
    const eslintStream = gulp.src(['src/**/*.js', 'src/**/*.jsx'])
        .pipe(eslint())
        .pipe(eslint.format())
        .pipe(eslint.results(results => {
            // For clarity, also give some output when there are no errors.
            if (results.errorCount === 0) {
                console.log(`No eslint errors.\n`)
            }
        }))
    await streamToPromise(eslintStream)

    const stylelintStream = gulp.src(['src/**/*.css'])
        .pipe(stylelint(stylelintOptions))
    await streamToPromise(stylelintStream)
})

gulp.task('lint-watch', gulp.series('lint', async function watchAndLint() {
    gulp.watch(['src/**/*.js', 'src/**/*.jsx'])
        .on('change', path => {
            return gulp.src(path)
                .pipe(eslint())
                .pipe(eslint.format())
        })

    gulp.watch(['src/**/*.css'])
        .on('change', path => {
            return gulp.src(path)
                .pipe(stylelint(stylelintOptions))
        })

    await indefinitely
}))

gulp.task('watch', gulp.parallel('build-watch', 'lint-watch'))


// === Tasks for packaging the extension; results go into ./dist/{browser} ===

function getManifest() {
    const manifest = JSON.parse(fs.readFileSync('./extension/manifest.json'))
    return manifest
}

function getFilename() {
    const { name, version } = getManifest()
    const filename = `${name.toLowerCase()}-${version}`
    return filename
}

gulp.task('package-firefox', async () => {
    const filename = getFilename()
    const buildXpiCommand = `web-ext -s ./extension -a ./dist/firefox build`
    await exec(buildXpiCommand)
    // web-ext will have named the file ${filename}.zip. Change .zip to .xpi.
    await exec(`mv dist/firefox/${filename}.zip dist/firefox/${filename}.xpi`)
})

gulp.task('package-chromium', async () => {
    const filename = getFilename()
    const buildCrxCommand = (
        `crx pack ./extension`
        + ` -o ./dist/chromium/${filename}.crx`
        + ` -p .chrome-extension-key.pem`
    )
    // crx fails if the output directory is not there.
    await exec(`mkdir -p dist/chromium`)
    await exec(buildCrxCommand)
})

// Run sequentially to keep output cleanly separated.
gulp.task('package', gulp.series('package-firefox', 'package-chromium'))


// === Tasks for publishing the extension ===

function readApiKeys() {
    try {
        return JSON.parse(fs.readFileSync('./.api-keys.json'))
    } catch (err) {
        throw new Error(
            'Expected to find API keys in .api-keys.json.'
            + ' For details, well best just read the gulpfile..'
        )
    }
}

// Publish to Mozilla Addons
gulp.task('publish-amo', async () => {
    const { MozillaAddons } = readApiKeys()
    const publishAmoCommand = (
        `web-ext sign`
        + ` -s ./extension`
        + ` -a ./dist/amo`
        + ` --api-key ${MozillaAddons.apiKey}`
        + ` --api-secret ${MozillaAddons.apiSecret}`
    )
    try {
        await exec(publishAmoCommand)
    } catch (err) {}
})

// Publish to Chrome Web Store
// TODO use gulp-crx-pack instead of using crx through exec()
gulp.task('publish-cws', async () => {
    const { ChromeWebStore } = readApiKeys()
    const publishCwsCommand = (
        `webstore upload --auto-publish`
        + ` --source ./extension`
        + ` --extension-id ${ChromeWebStore.extensionId}`
        + ` --client-id ${ChromeWebStore.clientId}`
        + ` --client-secret ${ChromeWebStore.clientSecret}`
        + ` --refresh-token ${ChromeWebStore.refreshToken}`
    )
    try {
        await exec(publishCwsCommand)
    } catch (err) {}
})

// Run sequentially to keep output cleanly separated.
gulp.task('publish', gulp.series('publish-amo', 'publish-cws'))
