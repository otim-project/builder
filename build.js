const LatexOnline = require('./lib/LatexOnline');
let latexOnline;

LatexOnline.create('/tmp/downloads/', '/tmp/storage/').then(
    function (initializedLatexOnline) {
        latexOnline = initializedLatexOnline;
        compileGit(
            'https://github.com/jakebian/OTIM-toen-mastercourse',
            'chapters/lecture1.tex',
            'pdflatex'
        )
    }
)

async function compileGit(gitRepo, targetFile, latexCommand, branch='master', workdir='') {
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
        console.log(compilation.userError);
    }

    if (compilation.success) {
        console.log(compilation.outputPath())
    }
}

function clearExistingCompilations(fingerprint) {
    const existingCompilation = latexOnline.compilationWithFingerprint(fingerprint);
    if (existingCompilation) {
        latexOnline.removeCompilation(existingCompilation)
    }
}

