#addin "Cake.Npm"
///////////////////////////////////////////////////////////////////////////////
// ARGUMENTS
///////////////////////////////////////////////////////////////////////////////

var target = Argument("target", "Default");
var configuration = Argument("configuration", "Release");

///////////////////////////////////////////////////////////////////////////////
// SETUP / TEARDOWN
///////////////////////////////////////////////////////////////////////////////

Setup(ctx =>
{
   // Executed BEFORE the first task.
   Information("Running tasks...");
});

Teardown(ctx =>
{
   // Executed AFTER the last task.
   Information("Finished running tasks.");
});

///////////////////////////////////////////////////////////////////////////////
// TASKS
///////////////////////////////////////////////////////////////////////////////

Task("Default")
.Does(() => {
   Information("Hello Cake!");
});

Task("InstallNpmProd")
    .Does(() =>
{
    var settings = 
        new NpmInstallSettings 
        {
            Production = true
        };
    NpmInstall(settings);
});

Task("ZipLambdaCode")
    .Does(() =>
{
    var nodeModules = System.IO.Directory.GetFiles("node_modules", "*", System.IO.SearchOption.AllDirectories);
    var filesToZip = new List<string>(nodeModules);
    filesToZip.Add("app.js");
    Zip("./", "generic-facebook-bot.zip", filesToZip.ToArray());
});

RunTarget(target);