const LatexOnline = require('./lib/LatexOnline');
const s3 = require('s3');
const { accessKeyId, secretAccessKey, region, Bucket } = require('./s3creds');
const octokit = require('@octokit/rest')()
const yaml = require('js-yaml');

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

        const config = await getConfig();
        const outputs = await compileFromConfig(config)
        uploadResult(outputs)
        console.log('completed');
    }
)

async function getConfig() {
    const nodes = await getNodesConfig();
    const pathsMap = await getPathsMap(nodes);
    return {
        nodes,
        pathsMap
    }
}

async function getPathsMap(nodesConfig) {
    return nodesConfig.reduce(async (result, {key, repo: nodeRepo }) => {
        const [ owner, repo ] = trimSlashes(nodeRepo).split('/');
        const nodeContent = await getNodeContent(owner, repo);
        return {
            ...result,
            [key]: getAllPaths(nodeContent)
        };
    }, {});
}

function getAllPaths(nodes) {
    return nodes.reduce((result, {path, sub}) => {
        if (sub) {
            return [...result, ...getAllPaths(sub)]
        }

        if (path) {
            return [...result, path];
        }

        return result
    }, []);
}

async function getNodesConfig() {
    const result = await octokit.repos.getContents({
        owner: 'otim-project',
        repo: 'root',
        path: 'nodes.yaml',
        ref: 'master'
    });
    return parseYamlConfig(result.data.content);
}

async function getNodeContent(owner, repo) {
    const result = await octokit.repos.getContents({
        owner,
        repo,
        path: '.otim/content.yaml',
        ref: 'master'
    })
    return parseYamlConfig(result.data.content);
}

function parseYamlConfig(rawFile) {
    return yaml.load(Buffer.from(rawFile, 'base64').toString());
}

function uploadResult(keyToOutputPathsMap) {
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
                uploader.on('end', () => console.log('uploaded', Key));
            })
        }
    )
}


function getRemotePath(sourcePath) {
    return `${trimSlashes(strimExtension(sourcePath))}.pdf`;
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
                                `https://github.com/${trimSlashes(repo)}`,
                                trimSlashes(path),
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



function trimSlashes(s) {
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

