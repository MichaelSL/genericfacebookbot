var gulp = require('gulp');
var clean = require('gulp-clean');
var zip = require('gulp-zip');
var merge = require('merge-stream');
var argv = require('yargs').argv;

gulp.task('clean', function () {
    var build = gulp.src('build', {read: false})
        .pipe(clean());
    var dist = gulp.src('dist', {read: false})
        .pipe(clean());

    return merge(build, dist);
});

gulp.task('copy', ['clean'], function(){
    var index = gulp.src('app.js')
        .pipe(gulp.dest('build'));
    var nodeModules = gulp.src('node_modules/**')
        .pipe(gulp.dest('build/node_modules'));

    return merge(index, nodeModules);
});

gulp.task('zip', ['copy'], function() {
    return gulp.src('build/**')
        .pipe(zip('generic-facebook-bot.zip'))
        .pipe(gulp.dest('dist'));
});

gulp.task('default', ['zip']);