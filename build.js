const LatexOnline = require('./lib/LatexOnline');
const s3 = require('s3');
const { accessKeyId, secretAccessKey, region, Bucket } = require('./s3creds');

const s3Client = s3.createClient({
  s3Options: {
    accessKeyId,
    secretAccessKey,
    region,
  },
});

let latexOnline;

LatexOnline.create('/tmp/downloads/', '/tmp/storage/').then(
    async function (initializedLatexOnline) {
        latexOnline = initializedLatexOnline;
        const outputs = await compileFromConfig({
            nodes: [
                {
                    key: 'toen-mastercourse',
                    repo: 'jakebian/OTIM-toen-mastercourse'
                },
                {
                    key: 'non-existence',
                    repo: 'jakebian/non-existence'
                }
            ],
            pathsMap: {
                'toen-mastercourse': [
                    '/chapters/lecture1.tex',
                    '/chapters/lecture2-3.tex'
                ]
            }
        })

        console.log(outputs)

        upload(outputs)
    }
)


function upload(keyToOutputPathsMap) {
    Object.keys(keyToOutputPathsMap).forEach(
        nodeKey => {
            const pathsMap = keyToOutputPathsMap[nodeKey];
            Object.keys(pathsMap).forEach(sourcePath => {
                const Key = `${nodeKey}/${getRemotePath(sourcePath)}`;
                const uploader = s3Client.uploadFile({
                    localFile: pathsMap[sourcePath],
                    s3Params: { Bucket, Key },
                });

                uploader.on('error', function(err) {
                  console.error(`unable to upload ${Key}`, err.stack);
                });
                uploader.on('progress', function() {
                    // future dev enhancement: add progress bar
                });
                uploader.on('end', () => console.log('uploaded', Key);
            })
        }
    )
}


function getRemotePath(sourcePath) {
    return `${trimLeadingSlash(strimExtension(sourcePath))}.pdf`;
}

function strimExtension(path) {
    return path.split('.').slice(0, -1).join('.')
}

async function compileFromConfig({nodes, pathsMap}) {
    const outputPathMaps = {};

    await Promise.all(
        nodes.map(
            async ({key, repo}) => {
                const paths = pathsMap[key];
                if (!outputPathMaps[key]) {
                    outputPathMaps[key] = {};
                }
                if (!paths) {
                    console.error(`Bad or missing metadata for node ${key} : ${repo}`)
                    return;
                }
                return Promise.all(
                    paths.map(
                        async path => {
                            const outputPath = await compileGit(
                                `https://github.com/${trimLeadingSlash(repo)}`,
                                trimLeadingSlash(path),
                            );
                            outputPathMaps[key][path] = outputPath;
                        }
                    )
                )
            }
        )
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

