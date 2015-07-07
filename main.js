(function() {

  var mod = angular.module('App', []);

  mod.controller('FontListController', function($scope, Fonts, Storage, util) {

    $scope.safeThreshold = 80;

    function digest() {
      $scope.$digest();
    }

    util.merge($scope, Fonts);

    Storage.setupAttribute($scope, 'text', 'Sample Text');
    Storage.setupAttribute($scope, 'side', 'right');
    Storage.setupAttribute($scope, 'size', 'auto');
    Storage.setupAttribute($scope, 'theme', 'dark');
    Storage.setupAttribute($scope, 'selected', []);
    Storage.setupAttribute($scope, 'textInList', false);
    Storage.setupAttribute($scope, 'search', '');

    Storage.setupAttribute($scope, 'mac', true);
    Storage.setupAttribute($scope, 'windows', true);
    Storage.setupAttribute($scope, 'google', true);
    Storage.setupAttribute($scope, 'safe', true);

    $scope.fontListFilter = function(font) {
      if ($scope.search) {
        try {
          if (!font.name.match(RegExp($scope.search, 'i'))) {
            return false;
          }
        } catch(e) {
          if (font.name.indexOf($scope.search) === -1) {
            return false;
          }
        }
      }
      if ($scope.safe && font.family.install_mac > $scope.safeThreshold && font.family.install_windows > $scope.safeThreshold) {
        return true;
      } else if (font.available_windows && $scope.windows) {
        return true;
      } else if (font.available_mac && $scope.mac) {
        return true;
      } else if (Fonts.isGoogleFont(font) && $scope.google) {
        return true;
      }
      return false;
    }

    $scope.addFont = function(font) {
      $scope.selected.push(font.id);
    };

    $scope.removeFont = function(index) {
      $scope.selected.splice(index, 1);
    }

    $scope.removeAllFonts = function() {
      if (confirm('Sure about that?')) {
        $scope.selected = [];
      }
    }

    $scope.getRandomFonts = function(limit) {
      var i = 0;
      while (i < limit) {
        var font = util.getRandom(Fonts.getAll());
        var exists = $scope.selected.indexOf(font) !== -1;
        if (!exists) {
          $scope.selected.push(font);
          i++;
        }
      }
    };

    $scope.$on('fontError', digest);
    $scope.$on('fontActivated', digest);

    $scope.$watch('search', function(set) {
      $scope.searchLoading = false;
    });

    Fonts.loadAll().then(function() {
      $scope.selected.forEach(function(id) {
        Fonts.queueWebFont(Fonts.getById(id));
      });
      $scope.fonts = Fonts.getAll();
    });

  });

  mod.service('Fonts', function($http, $q, $rootScope, $timeout, util) {

    var GOOGLE_FONTS_API_URL = 'https://www.googleapis.com/webfonts/v1/webfonts?key=AIzaSyApru_pt7gpUGUzfvCkQj8RpS9jGGhkttQ'
    var GOOGLE_FONTS_API_URL = 'fonts/google.json'
    var SYSTEM_FONTS_URL = 'fonts/system.json';

    var POSTSCRIPT_EXCEPTIONS = {
      'ArialBlack': 'Arial-Black',
      'TrebuchetMS-BoldItalic': 'Trebuchet-BoldItalic',
    }

    var all = [];
    var byId = {};
    var queuedWebFonts = [];

    function setSystemFontInstall(font, platform) {
      var notes = [];
      var pCap = util.capitalize(platform);
      var version = font.family['version_' + platform];
      var install = font.family['install_' + platform] || !!version;
      font['available_' + platform] = install;
      notes.push('Font is available on ' + (typeof install === 'number' ? install + '% of ' : '') + pCap + '.');
      if (version) {
        notes.push('Available from ' + pCap + ' ' + version + '.');
      }
      font['notes_' + platform] = notes.join(' ');
    }

    function transformSystemFont(font) {
      font.loaded = true;
      font.display_variant = font.variant.replace(/Regular/i, '400').replace(/Bold/i, '700');
      font.id = font.family.name + ':' + font.variant;
      setSystemFontInstall(font, 'windows');
      setSystemFontInstall(font, 'mac');
      return font;
    }

    function transformGoogleFont(font) {
      font.platform = 'Google Fonts';
      switch(font.variant) {
        case 'regular':
          font.display_variant = '400';
          break;
        case 'italic':
          font.display_variant = '400 Italic';
          break;
        default:
          font.display_variant = font.variant.replace(/(\d+)italic/, '$1 Italic');
      }
      font.fvd = (font.display_variant.match(/italic/i) ? 'i' : 'n') + (font.display_variant.charAt(0));
      font.id = font.family.name + ':' + font.fvd;
      return font;
    }

    function appendFonts(fontFamilies, transformFn) {
      fontFamilies.forEach(function(family, i) {
        family.name = family.family;
        var variants = family.variants;
        if (typeof variants === 'string') {
          variants = variants.split(/,\s*/);
        }
        variants.forEach(function(variant) {
          var font = transformFn({
            family: family,
            variant: variant
          });
          font.name = family.name + ' ' + font.display_variant;
          all.push(font);
          byId[font.id] = font;
        });
      });
    }

    function loadSystemFonts() {
      return $http.get(SYSTEM_FONTS_URL).then(function(response) {
        appendFonts(response.data, transformSystemFont);
      });
    }

    function loadGoogleFonts() {
      return $http.get(GOOGLE_FONTS_API_URL).then(function(response) {
        appendFonts(response.data.items, transformGoogleFont);
      });
    }

    function sortAll() {
      all.sort(function(a, b) {
        var result = util.alphanumericSort(a.family.name, b.family.name);
        if (result === 0) {
          var aVariant = a.display_variant || a.variant;
          var bVariant = b.display_variant || b.variant;
          if (aVariant.length !== bVariant.length) {
            result = aVariant.length - bVariant.length;
          } else {
            result = util.alphanumericSort(aVariant, bVariant);
          }
        }
        return result;
      });
    }

    function loadFinished() {
      $timeout(function() {
        $rootScope.$emit('fontsLoaded');
      });
    }

    function isGoogleFont(font) {
      return font.platform == 'Google Fonts';
    }

    function loadAllWebFonts() {
      if (!queuedWebFonts.length) {
        return;
      }
      WebFont.load({
        active: function() {
          queuedWebFonts = [];
        },
        fontinactive: function(family, fvd) {
          var font = byId[family + ':' + fvd];
          font.loading = false;
          font.error = true;
          $rootScope.$broadcast('fontError');
        },
        fontactive: function(family, fvd) {
          var font = byId[family + ':' + fvd];
          font.loading = false;
          font.loaded = true;
          $rootScope.$broadcast('fontActivated');
        },
        google: {
          families: queuedWebFonts.map(function(font) {
            return font.family.name + ':' + font.variant;
          })
        }
      });
    }

    function getWeightForVariant(variant) {
      var match = variant.match(/\d+/);
      return match ? match[0] : null;
    }

    function getStyleForVariant(variant) {
      var match = variant.match(/italic/i);
      return match ? 'italic' : null;
    }

    function getPostscriptFamilyName(font) {
      var family = font.family.name.replace(/\s/g, '');
      var variant = font.variant.replace(/[\s-]|Regular/gi, '');

      var fSuffix = font.family.postscript_family_suffix || '';
      var vSuffix = font.family.postscript_variant_suffix || '';

      var ps = family + fSuffix + (variant ? '-' + variant : '') + vSuffix;
      return POSTSCRIPT_EXCEPTIONS[ps] || ps;
    }

    var callWebFontLoad = util.debounce(loadAllWebFonts, 500);

    this.isGoogleFont = isGoogleFont;

    this.getStyleForFont = function(font) {
      if (isGoogleFont(font)) {
        if (font.loaded) {
          return {
            // Looks like quotation marks are needed for JQLite, even though
            // the CSS is valid without them.
            'font-family': "'" + font.family.name + "'",
            'font-weight': getWeightForVariant(font.variant),
            'font-style': getStyleForVariant(font.variant)
          };
        }
      } else {
        return {
          'font-family': getPostscriptFamilyName(font)
        };
      }
    }

    this.getAll = function() {
      return all;
    }

    this.getById = function(id) {
      return byId[id];
    }

    this.loadAll = function() {
      return $q.all([loadSystemFonts(), loadGoogleFonts()]).then(sortAll).then(loadFinished);
    }

    this.queueWebFont = function(font) {
      if (isGoogleFont(font)) {
        if (!font.loaded) {
          font.loading = true;
          queuedWebFonts.push(font);
          callWebFontLoad();
        }
      }
    }

  });

  mod.service('Storage', function() {

    this.setupAttribute = function(scope, name, defaultValue) {
      var json = (typeof defaultValue).match(/object|boolean/);
      var set = localStorage.getItem(name) || defaultValue;
      scope[name] = json ? angular.fromJson(set) : set;
      scope.$watch(name, function(set) {
        localStorage.setItem(name, json ? angular.toJson(set) : set);
      }, true);
    }

  });

  mod.service('util', function($timeout) {

    function normalize(str) {
      return str.replace(/['*-]/g, '');
    }

    this.getRandom = function(arr) {
      return arr[Math.floor(Math.random() * arr.length)];
    }

    this.capitalize = function(str) {
      return str[0].toUpperCase() + str.slice(1);
    }

    this.nlbr = function(str) {
      return str.replace(/\n/, '<br>');
    }

    this.alphanumericSort = function(a, b) {
      var aNorm = normalize(a);
      var bNorm = normalize(b);
      if (aNorm < bNorm) {
        return -1;
      } else if (aNorm > bNorm) {
        return 1;
      }
      return 0;
    }

    this.debounce = function(srcFn, ms) {
      var promise;
      var fn = function() {
        var self = this, args = arguments;
        fn.cancel();
        promise = $timeout(function() {
          return srcFn.apply(self, args);
        }, ms || 0);
        return promise;
      }
      fn.cancel = function() {
        if (promise) {
          $timeout.cancel(promise);
          promise = null;
        }
      }
      return fn;
    }

    this.merge = function(target, src) {
      for (var key in src) {
        if(!src.hasOwnProperty(key)) continue;
        target[key] = src[key];
      };
    }

  });

  mod.filter('capitalize', function(util) {
    return util.capitalize;
  });

  mod.filter('nlbr', function(util) {
    return util.nlbr;
  });

  mod.filter('getFont', function(Fonts) {
    return function(names) {
      var result = [];
      names.forEach(function(id) {
        var font = Fonts.getById(id);
        if (font) {
          result.push(font);
        }
      });
      return result;
    }
  });

  mod.directive('onScrollEnter', function($rootScope, $window, util) {

    var parent;
    var waypoints = [];
    var currentWaypoint;

    function addWaypoint(waypoint) {
      if (!parent) {
        parent = waypoint.el.parentNode;
        angular.element(parent).on('scroll', deferredCheckWaypoints);
      }
      waypoints.push(waypoint);
      return waypoint;
    }

    function removeWaypoint(waypoint) {
      waypoints = waypoints.filter(function(w) {
        return w != waypoint;
      });
      deferredCheckWaypoints();
    }

    function checkWaypoints() {
      if (waypoints.length === 0) {
        return;
      }
      var scrollTop = parent.scrollTop;
      var scrollBottom = scrollTop + parent.offsetHeight;
      var i = 0;
      while (i < waypoints.length) {
        var w = waypoints[i];
        var top = w.el.offsetTop;
        var bottom = w.el.offsetTop;
        var padding = w.padding;
        if (top > scrollBottom + padding) {
          // No need to check the rest of the elements, so break out.
          break;
        } else if (top >= scrollTop - padding && bottom <= scrollBottom + padding) {
          // Fire the handler and remove the waypoint from the array.
          w.enter();
          waypoints.splice(0, 1);
        } else {
          i++;
        }
      }
    }

    var deferredCheckWaypoints = util.debounce(checkWaypoints, 500);

    $rootScope.$on('fontsLoaded', checkWaypoints);
    angular.element($window).on('resize', checkWaypoints);

    return {
      restrict: 'A',
      link: function(scope, element, attr) {
        var waypoint = addWaypoint({
          el: element[0],
          padding: parseInt(attr['scrollPadding'], 10) || 0,
          enter: function() {
            scope.$apply(attr['onScrollEnter']);
          }
        });
        scope.$on('$destroy', function() {
          removeWaypoint(waypoint);
        });
      }
    };
  });

  mod.directive('textFitContainer', function($window, util) {

    var MIN_SIZE = 6;

    return {
      restrict: 'A',
      controller: function($scope, $element) {
        var fontSize;
        var container = $element[0];
        var elements = angular.element();

        function setSize(s) {
          angular.forEach(elements, function(el) {
            el.style.fontSize = s ? s + 'px' : '';
          });
        }

        function getSize() {
          fontSize = parseInt($window.getComputedStyle(elements[0]).fontSize, 10);
        }

        function fit() {
          if (!elements.length) {
            return;
          }
          if ($scope.size != 'auto') {
            setSize($scope.size);
            return;
          }
          setSize();
          getSize();
          while (canContinue()) {
            fontSize--;
            angular.forEach(elements, function(el) {
              el.style.fontSize = fontSize + 'px';
            });
          }
        }

        function canContinue() {
          return fontSize > MIN_SIZE && container.scrollHeight > container.clientHeight;
        }

        this.register = function(el) {
          elements.push(el);
        }

        this.fit = util.debounce(fit);

        $scope.$watch('size', fit);

        angular.element($window).on('resize', util.debounce(fit, 500));
        angular.element($window).on('orientationchange', util.debounce(fit, 500));
      }
    }
  });

  mod.directive('textFit', function() {

    return {
      restrict: 'A',
      require: '^textFitContainer',
      scope: {
        text: '=textFit'
      },
      link: function(scope, element, attr, textFitController) {
        textFitController.register(element[0]);
        scope.$watch('text', function(text) {
          element.html(text);
          textFitController.fit();
        });
      }
    }
  });

})();
