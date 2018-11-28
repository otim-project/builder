const LatexOnline = require('./lib/LatexOnline');
const s3 = require('s3');
const { accessKeyId, secretAccessKey, region, Bucket } = require('./s3creds');
const octokit = require('@octokit/rest')()
const yaml = require('js-yaml');
const request = require('request');

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
        const uploadTask = await uploadResult(outputs)
        console.log('uploaded everthing, triggering site build')
        const triggerSiteBuild = await request.post(process.env.SITE_BUILD_TRIGGER);
        console.log('triggered site build')
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
    return nodesConfig.reduce(async (resultPromise, {key, repo: nodeRepo }) => {
        const result = await resultPromise;
        const [ owner, repo ] = trimSlashes(nodeRepo).split('/');
        const nodeContent = await getNodeContent(owner, repo);
        return {
            ...result,
            [key]: getAllPaths(nodeContent)
        };
    }, Promise.resolve({}));
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
    return Promise.all(
        Object.keys(keyToOutputPathsMap).reduce(
            (result, nodeKey) => {
                const pathsMap = keyToOutputPathsMap[nodeKey];
                return [
                    ...result,
                    ...Object.keys(pathsMap).map(sourcePath => {

                        return new Promise((resolve, reject) => {
                            const Key = `${nodeKey}/${getRemotePath(sourcePath)}`;
                            const uploader = s3Client.uploadFile({
                                localFile: pathsMap[sourcePath],
                                s3Params: { Bucket, Key },
                            });

                            uploader.on('error', (err) => {
                              console.error(`unable to upload ${Key}`, err.stack);
                              reject(err);
                            });
                            uploader.on('progress', function() {
                                // future dev enhancement: add progress bar
                            });
                            uploader.on('end', () => {
                                console.log('uploaded', Key)
                                resolve(Key);
                            });
                        })
                    })
                ]
            },
            []
        )
    );
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

