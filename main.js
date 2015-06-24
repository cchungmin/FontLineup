(function() {


  var mod = angular.module('App', []);

  function getRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function normalize(str) {
    return str.replace(/['*-]/g, '');
  }

  function capitalize(str) {
    return str[0].toUpperCase() + str.slice(1);
  }

  function alphanumericSort(a, b) {
    var aNorm = normalize(a);
    var bNorm = normalize(b);
    if (aNorm < bNorm) {
      return -1;
    } else if (aNorm > bNorm) {
      return 1;
    }
    return 0;
  }

  function getPostscriptFamilyName(font) {
    var postscriptFamily = font.family.replace(/\s/g, '');
    var postscriptFace = font.variant.replace(/[\s-]/g, '');
    return postscriptFamily + (postscriptFace == 'Regular' ? '' : '-' + postscriptFace);
  }

  function setupStoredAttribute(scope, name, defaultValue) {
    var json = typeof defaultValue == 'object';
    var set = localStorage.getItem(name) || defaultValue;
    scope[name] = json ? angular.fromJson(set) : set;
    scope.$watch(name, function(set) {
      localStorage.setItem(name, json ? angular.toJson(set) : set);
    }, true);
  }

  mod.controller('FontListController', function($scope, $timeout, Fonts) {

    setupStoredAttribute($scope, 'text', 'Hi there');
    setupStoredAttribute($scope, 'side', 'top');
    setupStoredAttribute($scope, 'theme', 'light');
    setupStoredAttribute($scope, 'selected', []);

    $scope.addFont = function(font) {
      $scope.selected.push(font);
    };

    $scope.removeFont = function(index) {
      $scope.selected.splice(index, 1);
    }

    $scope.removeAllFonts = function() {
      if (confirm('Sure about that?')) {
        $scope.selected = [];
      }
    }

    $scope.getVariants = Fonts.getVariants;
    $scope.queueWebFont = Fonts.queueWebFont;

    $scope.getStyleForFont = function(font) {
      if (Fonts.isGoogleFont(font)) {
        return {
          'font-family': font.family,
          'font-weight': Fonts.getWeightForVariant(font.variant),
          'font-style': Fonts.getStyleForVariant(font.variant)
        };
      } else {
        return {
          'font-family': getPostscriptFamilyName(font)
        };
      }
    }

    $scope.getRandomFonts = function(limit) {
      var arr = $scope.selected, i = 0;
      while (i < limit) {
        var family = getRandom(Fonts.all()).family;
        var face = getRandom(Fonts.getVariants(family));
        var exists = arr.some(function(f) {
          return f.family == family && f.face == face;
        });
        if (!exists) {
          arr.push({
            family: family,
            face: face
          });
          i++;
        }
      }
    };

    Fonts.load().then(function() {
      $scope.fonts = $scope.fontSelect = Fonts.all();
      $scope.fontsByScript = Fonts.byScript();
      $scope.fontsByPlatform = Fonts.byPlatform();
    });

  });

  mod.service('Fonts', function($http, $q, util) {

    var GOOGLE_FONTS_API_URL = 'https://www.googleapis.com/webfonts/v1/webfonts?key=AIzaSyApru_pt7gpUGUzfvCkQj8RpS9jGGhkttQ'
    var GOOGLE_FONTS_CSS_URL = 'http://fonts.googleapis.com/css?family='
    //http://fonts.googleapis.com/css?family=Roboto:400,500italic,700|Open+Sans:600italic,700italic,400'
    var GOOGLE_FONTS_API_URL = 'fonts/google.json'
    var SYSTEM_FONTS_URL = 'fonts/system.json';

    var all = [];
    var queuedWebFonts = [];
    var googleLoadedFonts = {};
    var byFamily = {};
    var byPlatform;
    var byScript;

    var googleVariantsByDisplayName = {};

    function transformSystemFont(font, variant) {
      //font['platform'] = platform + (font['version'] ? ' ' + font['version'] : '');
      //font['variants'] = font['variants'].split(/,\s+/).sort();
      return font;
    }

    function transformGoogleFont(font) {
      font.platform = 'Google Fonts';
      switch(font.variant) {
        case 'regular':
          font.variant = '400';
          break;
        case 'italic':
          font.variant = '400 Italic';
          break;
        default:
          font.variant = font.variant.replace(/(\d+)italic/, '$1 Italic');
      }
      return font;
    }

    /*
    function transformGoogleFontVariant(str) {
      var display = str.replace(/(\d+)?([a-z]+)/i, function(m, num, style) {
        return (num ? num + ' ' : '') + (style.charAt(0).toUpperCase() + style.slice(1));
      });
      googleVariantsByDisplayName[display] = str;
      return display;
    }
   */

    function appendFonts(fontFamilies, transformFn) {
      fontFamilies = fontFamilies.slice(0, 40);
      fontFamilies.forEach(function(family) {
        var variants = family.variants;
        if (typeof variants === 'string') {
          variants = variants.split(/,\s*/);
        }
        variants.forEach(function(variant) {
          var font = transformFn({
            family: family.family,
            variant: variant
          });
          font.name = family.family + ' ' + capitalize(font.variant),
          all.push(font);
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
        var result = alphanumericSort(a.family, b.family);
        if (result === 0) {
          if (a.variant.length !== b.variant.length) {
            result = a.variant.length - b.variant.length;
          } else {
            result = alphanumericSort(a.variant, b.variant);
          }
        }
        return result;
      });
    }

    function getGroup(field, fallbackText) {
      var result = {}, grouped = [];
      all.forEach(function(font) {
        var label = font[field] || fallbackText;
        var group = result[label];
        if (!group) {
          group = result[label] = [];
        }
        group.push(font);
      });
      return result;
    }

    function groupAll() {
      byPlatform = getGroup('platform', 'None');
      byScript = getGroup('script', 'Multiple');
    }

    function isGoogleFont(font) {
      return font.platform == 'Google Fonts';
    }

    function updateGoogleLoadUrl() {
      var families = [];
      for (var f in googleLoadedFonts) {
        if(!googleLoadedFonts.hasOwnProperty(f)) continue;
        var family = googleLoadedFonts[f];
        var variants = [];
        for (var v in family) {
          if(!family.hasOwnProperty(v)) continue;
          variants.push(v);
        };
        families.push(f.replace(/\s/g, '+') + ':' + variants.join(','));
      };
      if (families.length) {
        googleLoadUrl = GOOGLE_FONTS_CSS_URL + families.join('|');
      }
    }

    function loadWebFonts() {
      WebFont.load({
        google: {
          families: queuedWebFonts.map(function(f) {
            return f.family + ':' + f.variant;
          })
        }
      });
    }

    var deferredLoadWebFonts = util.debounce(loadWebFonts, 500);

    this.isGoogleFont = isGoogleFont;

    this.getWeightForVariant = function(variant) {
      var match = variant.match(/\d+/);
      return match ? match[0] : null;
    }

    this.getStyleForVariant = function(variant) {
      var match = variant.match(/italic/i);
      return match ? 'italic' : null;
    }

    this.load = function() {
      return $q.all([loadSystemFonts(), loadGoogleFonts()]).then(sortAll).then(groupAll);
    }

    this.queueWebFont = function(font) {
      if (isGoogleFont(font)) {
        queuedWebFonts.push(font);
        deferredLoadWebFonts();
      }
    }

    this.getVariants = function(family) {
      return byFamily[family].variants;
    }

    this.all = function() {
      return all;
    }

    this.byPlatform = function() {
      return byPlatform;
    }

    this.byScript = function() {
      return byScript;
    }

  });

  mod.directive('fontResize', function($window) {

    return {
      restrict: 'A',
      scope: {
        change: '=fontResize'
      },
      link: function(scope, element) {

        scope.$watch('change', handleResize, true);

        function handleResize() {
          angular.forEach(element.children(), function(el) {
          });
        }

        handleResize();
        angular.element($window).on('resize', handleResize);
      }
    }
  });

  mod.service('util', function($timeout) {

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
  });

  mod.filter('userFilter', function() {
    return function (font) {
      return font;
    }
  });

  mod.filter('capitalize', function() {
    return capitalize;
  });

  mod.filter('nlbr', function() {
    return function (str) {
      return str.replace(/\n/, '<br>');
    }
  });

  mod.directive('onScrollPast', function($window, util) {

    var parent;
    var waypoints = [];

    function addWaypoint(el, enter) {
      var waypoint = {
        el: el,
        enter: enter
      };
      if (!parent) {
        parent = el.parentNode;
        angular.element(parent).on('scroll', deferredCheckWaypoints);
      }
      waypoints.push(waypoint);
      return waypoint;
    }

    function removeWaypoint(waypoint) {
      waypoints = goog.array.filter(waypoints, function(w) {
        return w != waypoint;
      });
    }

    function checkWaypoints() {
      if (waypoints.length === 0) {
        return;
      }
      var parentScrollBottom = parent.offsetTop + parent.offsetHeight + parent.scrollTop;
      while (true) {
        var w = waypoints[0];
        if (w && w.el.offsetTop < parentScrollBottom) {
          w.enter();
          waypoints.splice(0, 1);
        } else {
          break;
        }
      }
    }

    var deferredCheckWaypoints = util.debounce(checkWaypoints, 500);
    angular.element($window).on('load', deferredCheckWaypoints);

    return {
      restrict: 'A',
      link: function(scope, element, attr) {
        var waypoint = addWaypoint(element[0], function() {
          scope.$apply(attr['onScrollPast']);
        });
        scope.$on('$destroy', function() {
          removeWaypoint(waypoint);
        });
      }
    };
  });

  mod.directive('textFitContainer', function($window, util) {

    var MIN_SIZE = 10;

    return {
      restrict: 'A',
      controller: function($element) {
        var fontSize;
        var container = $element[0];
        var elements = angular.element();

        function release() {
          angular.forEach(elements, function(el) {
            el.style.fontSize = '';
          });
        }

        function getSize() {
          fontSize = parseInt($window.getComputedStyle(elements[0]).fontSize, 10);
        }

        function fit() {
          release();
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
        angular.element($window).on('resize orientationchange', util.debounce(fit, 500));
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
      link: function(scope, element, attr, textFitContainer) {
        textFitContainer.register(element[0]);
        scope.$watch('text', function(text) {
          element.html(text);
          textFitContainer.fit();
        });
      }
    }
  });

})();
