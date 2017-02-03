module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    uglify: {
      options: {
        banner: '/*! <%= pkg.name %> <%= grunt.template.today("yyyy-mm-dd h:MM:ss") %> */\n'
      },
      build: {
        src: 'dist/<%= pkg.name %>.js',
        dest: 'dist/<%= pkg.name %>.min.js'
      }
    },
    qunit: {
      all:['test/*.html']
    },
    shell: {
      make: {
	command:'make bundle'
      },
      notify: {
	command:'notify-send \'Finished building the project!\''
      }
    },
    min : {
      dist:{
	src:['dist/<%= pkg.name %>.js'],
	dest:'dist/<%= pkg.name %>.min.js'
      }
    }
  });

  // Load the plugin that provides the "uglify" task.
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-qunit');
  grunt.loadNpmTasks('grunt-yui-compressor');
  grunt.loadNpmTasks('grunt-shell');

  grunt.registerTask('test', ['qunit']);
  grunt.registerTask('uglify', ['uglify']);
  grunt.registerTask('bundle', ['shell:make']);
  grunt.registerTask('minify', ['min']);
  grunt.registerTask('make', ['shell:make','min']);

  // Default task(s).
  grunt.registerTask('default', ['test', 'make', 'shell:notify']);


};
