const LatexOnline = require('./lib/LatexOnline');
let latexOnline;

LatexOnline.create('/tmp/downloads/', '/tmp/storage/').then(
    function (initializedLatexOnline) {
        latexOnline = initializedLatexOnline;
        console.log(

            compileFromConfig({
                nodes: [{
                    key: 'toen-mastercourse',
                    repo: 'jakebian/OTIM-toen-mastercourse'
                }],
                pathsMap: {
                    'toen-mastercourse': [
                        "/chapters/lecture1.tex",
                        "/chapters/lecture2-3.tex"
                    ]
                }
            })

        )
    }
)

function compileFromConfig({nodes, pathsMap}) {
    const outputPathMaps = {};
    nodes.forEach(
        ({key, repo}) => {
            const paths = pathsMap[key];
            if (!outputPathMaps[key]) {
                outputPathMaps[key] = {};
            }
            if (!paths) {
                console.error(`Bad or missing metadata for node ${key} : ${repo}`)
                return;
            }
            paths.forEach(
                path => {
                    const outputPath = compileGit(
                        `https://github.com/${trimLeadingSlash(repo)}`,
                        trimLeadingSlash(path),
                    );
                    outputPathMaps[key][path] = outputPath;
                }
            )
        }
    )
    return outputPathMaps;
}

function trimLeadingSlash(s) {
    return s.replace(/^\/|\/$/g, '');
}

async function compileGit(gitRepo, targetFile, latexCommand='pdflatex', branch='master', workdir='') {
    const preparation = await latexOnline.prepareGitCompilation(
        gitRepo,
        targetFile,
        branch,
        latexCommand,
        workdir
    );

    if (preparation) {
        return compilePreparation(preparation);
    }
}

async function compilePreparation(preparation) {
    const {request, downloader, userError} = preparation;

    clearExistingCompilations(request.fingerprint);
    const compilation = latexOnline.getOrCreateCompilation(request, downloader);
    await compilation.run();
    downloader.dispose();

    if (compilation.userError) {
        console.error(compilation.userError);
    }

    if (compilation.success) {
        return compilation.outputPath();
    }
}

function clearExistingCompilations(fingerprint) {
    const existingCompilation = latexOnline.compilationWithFingerprint(fingerprint);
    if (existingCompilation) {
        latexOnline.removeCompilation(existingCompilation)
    }
}

