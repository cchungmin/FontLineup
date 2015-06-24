(function() {


  var mod = angular.module('App', []);

  mod.controller('FontListController', function($scope, Fonts, Storage, util) {

    Storage.setupAttribute($scope, 'text', 'Hi there');
    Storage.setupAttribute($scope, 'side', 'top');
    Storage.setupAttribute($scope, 'theme', 'light');
    Storage.setupAttribute($scope, 'selected', []);

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

    Fonts.load().then(function() {
      $scope.fonts = Fonts.getAll();
    });

    util.merge($scope, Fonts);

  });

  mod.service('Fonts', function($http, $q, util) {

    var GOOGLE_FONTS_API_URL = 'https://www.googleapis.com/webfonts/v1/webfonts?key=AIzaSyApru_pt7gpUGUzfvCkQj8RpS9jGGhkttQ'
    var GOOGLE_FONTS_API_URL = 'fonts/google.json'
    var SYSTEM_FONTS_URL = 'fonts/system.json';

    var all = [];
    var queuedWebFonts = [];

    function transformSystemFont(font, variant) {
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

    function appendFonts(fontFamilies, transformFn) {
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
          font.name = family.family + ' ' + util.capitalize(font.variant),
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
        var result = util.alphanumericSort(a.family, b.family);
        if (result === 0) {
          if (a.variant.length !== b.variant.length) {
            result = a.variant.length - b.variant.length;
          } else {
            result = util.alphanumericSort(a.variant, b.variant);
          }
        }
        return result;
      });
    }

    function isGoogleFont(font) {
      return font.platform == 'Google Fonts';
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

    function getWeightForVariant(variant) {
      var match = variant.match(/\d+/);
      return match ? match[0] : null;
    }

    function getStyleForVariant(variant) {
      var match = variant.match(/italic/i);
      return match ? 'italic' : null;
    }

    function getPostscriptFamilyName(font) {
      var postscriptFamily = font.family.replace(/\s/g, '');
      var postscriptFace = font.variant.replace(/[\s-]/g, '');
      return postscriptFamily + (postscriptFace == 'Regular' ? '' : '-' + postscriptFace);
    }

    var deferredLoadWebFonts = util.debounce(loadWebFonts, 200);

    this.getStyleForFont = function(font) {
      if (isGoogleFont(font)) {
        return {
          'font-family': font.family,
          'font-weight': getWeightForVariant(font.variant),
          'font-style': getStyleForVariant(font.variant)
        };
      } else {
        return {
          'font-family': getPostscriptFamilyName(font)
        };
      }
    }

    this.getAll = function() {
      return all;
    }

    this.load = function() {
      return $q.all([loadSystemFonts(), loadGoogleFonts()]).then(sortAll);
    }

    this.queueWebFont = function(font) {
      if (isGoogleFont(font)) {
        queuedWebFonts.push(font);
        deferredLoadWebFonts();
      }
    }

  });

  mod.service('Storage', function() {

    this.setupAttribute = function(scope, name, defaultValue) {
      var json = typeof defaultValue == 'object';
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

  mod.filter('userFilter', function() {
    return function (font) {
      return font;
    }
  });

  mod.filter('capitalize', function(util) {
    return util.capitalize;
  });

  mod.filter('nlbr', function(util) {
    return util.nlbr;
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
