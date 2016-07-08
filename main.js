(function() {

  var mod = angular.module('App', []);

  mod.controller('FontListController', function($scope, Fonts, Storage, util) {

    $scope.safeThreshold = 80;

    function digest() {
      $scope.$digest();
    }

    function fontIsSafe(font) {
      return font.family.install_mac > $scope.safeThreshold &&
             font.family.install_windows > $scope.safeThreshold;
    }

    function setStarredFonts() {
      var map = {};
      $scope.starredIds.forEach(function(s) {
        map[s] = true;
      });
      $scope.fonts.forEach(function(font) {
        if (map[font.id]) {
          font.starred = true;
        }
      });
    }

    function setFontStates(bool) {
      $scope.mac       = bool;
      $scope.windows   = bool;
      $scope.installed = bool;
      $scope.starred   = bool;
      $scope.google    = bool;
      $scope.safe      = bool;
    }

    util.merge($scope, Fonts);

    Storage.setupAttribute($scope, 'text', 'Sample Text');
    Storage.setupAttribute($scope, 'theme', 'dark');
    Storage.setupAttribute($scope, 'selected', []);
    Storage.setupAttribute($scope, 'panelSide', 'right');
    Storage.setupAttribute($scope, 'panelClosed', false);
    Storage.setupAttribute($scope, 'textInList', false);
    Storage.setupAttribute($scope, 'search', '');
    Storage.setupAttribute($scope, 'starredIds', []);

    Storage.setupAttribute($scope, 'starred',   false);
    Storage.setupAttribute($scope, 'installed', true);
    Storage.setupAttribute($scope, 'windows',   false);
    Storage.setupAttribute($scope, 'mac',       false);
    Storage.setupAttribute($scope, 'google',    false);
    Storage.setupAttribute($scope, 'safe',      false);

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
      if ($scope.safe && fontIsSafe(font)) {
        return true;
      } else if (font.installed && $scope.installed) {
        return true;
      } else if (font.available_windows && $scope.windows) {
        return true;
      } else if (font.available_mac && $scope.mac) {
        return true;
      } else if (Fonts.isGoogleFont(font) && $scope.google) {
        return true;
      } else if (font.starred && $scope.starred) {
        return true;
      }
      return false;
    };

    $scope.setTab = function(name) {
      setFontStates(false);
      $scope[name] = true;
    };

    $scope.getSize = function() {
      return $scope.size === 'auto' ? 'auto' : $scope.size + 'px';
    };

    $scope.addStarredFont = function(font) {
      font.starred = true;
      $scope.starredIds.push(font.id);
    };

    $scope.removeStarredFont = function(font) {
      font.starred = false;
      util.removeFromArray($scope.starredIds, font.id);
    };

    $scope.addFont = function(font) {
      if ($scope.selected.indexOf(font.id) === -1) {
        $scope.selected.push(font.id);
      }
    };

    $scope.removeFont = function(index) {
      $scope.selected.splice(index, 1);
    };

    $scope.removeAllFonts = function() {
      if (confirm('Sure about that?')) {
        $scope.selected = [];
      }
    };

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
      $scope.$emit('fontsFiltered');
      $scope.searchLoading = false;
    });

    Fonts.loadAll().then(function() {
      $scope.selected.forEach(function(id) {
        Fonts.queueWebFont(Fonts.getById(id));
      });
      $scope.fonts = Fonts.getAll();
      setFontStates(true);
      setStarredFonts();
    });

  });


  mod.service('Fonts', function($http, $q, $rootScope, $timeout, util) {

    var GOOGLE_FONTS_API_URL = 'https://www.googleapis.com/webfonts/v1/webfonts?key=AIzaSyApru_pt7gpUGUzfvCkQj8RpS9jGGhkttQ';
    var WEBFONT_LOADER_MAX_CONCURRENT = 8;
    //var GOOGLE_FONTS_API_URL = 'fonts/google.json'
    var SYSTEM_FONTS_URL = 'fonts/system.json';

    var POSTSCRIPT_EXCEPTIONS = {
      'ArialBlack': 'Arial-Black',
      'TrebuchetMS-BoldItalic': 'Trebuchet-BoldItalic'
    };

    var all = [];
    var byId = {};
    var queuedWebFonts = [];
    var installedDetected;

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

    function getDisplayVariant(variant) {
      return variant.replace(/Regular/i, '400').replace(/Bold/i, '700');
    }

    function transformSystemFont(font) {
      font.loaded = true;
      font.display_variant = getDisplayVariant(font.variant);
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
      fontFamilies.forEach(function(family) {
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
      return font.platform && font.platform == 'Google Fonts';
    }

    function loadAllWebFonts() {
      if (!queuedWebFonts.length) {
        return;
      }
      var fontsToLoad = queuedWebFonts.slice(0, WEBFONT_LOADER_MAX_CONCURRENT);
      queuedWebFonts = queuedWebFonts.slice(WEBFONT_LOADER_MAX_CONCURRENT);
      WebFont.load({
        active: loadAllWebFonts,
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
          families: fontsToLoad.map(function(font) {
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
      var family = font.family.name;
      var variant = font.variant.replace(/[\s-]|Regular/gi, '');

      var fSuffix = font.family.postscript_family_suffix || '';
      var vSuffix = font.family.postscript_variant_suffix || '';

      if (variant) {
        // Only replace the spaces in the family
        // name if there is a variant. This seems to
        // trigger the most proper font renderings.
        family = family.replace(/\s/g, '');
      }

      var ps = family + fSuffix + (variant ? '-' + variant : '') + vSuffix;
      return POSTSCRIPT_EXCEPTIONS[ps] || ps;
    }


    function detectInstalled() {
      var deferred = $q.defer();
      var id = 'font-detect-swf';
      if (!swfobject.hasFlashPlayerVersion('9')) {
        installedDetected = false;
        deferred.resolve('No Flash Player');
      } else {
        onFontDetectReady = function() {
          var el = document.getElementById(id);
          el.fonts().forEach(function(f) {
            var variant = f.fontStyle.slice(0, 1).toUpperCase() + f.fontStyle.slice(1);
            var id = f.fontName + ':' + variant;
            var font = byId[id];
            if (font) {
              font.installed = true;
            } else {
              font = {
                family: {
                  name: f.fontName
                },
                id: id,
                name: f.fontName + ' ' + variant,
                display_variant: getDisplayVariant(variant),
                variant: variant,
                loaded: true,
                installed: true
              };
              all.push(font);
              byId[id] = font;
            }
          });
          installedDetected = true;
          deferred.resolve();
        };
        swfobject.embedSWF('detect/font-list.swf', id, '1', '1', '9.0.0', false, {
          onReady: 'onFontDetectReady',
          swfObjectId: id
        }, {
          allowScriptAccess: 'always',
          menu: 'false'
        }, {
          id: id,
          name: id
        });
      }
      return deferred.promise;
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
      return $q.all([loadSystemFonts(), loadGoogleFonts()])
        .then(detectInstalled)
        .then(sortAll)
        .then(loadFinished);
    }

    this.canDetectInstalled = function() {
      return installedDetected;
    }

    this.queueWebFont = function(font) {
      if (isGoogleFont(font)) {
        if (!font.loaded && !font.loading) {
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

    this.removeFromArray = function(arr, el) {
      var index = this.indexOf(arr, el);
      if (index !== -1) {
        arr.splice(index, 1);
      }
    };

    this.indexOf = function(arr, el) {
      // jqLite doesn't have an indexOf. Why? Who knows...
      if (arr.indexOf) {
        return arr.indexOf(el);
      }
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] === el) {
          return i;
        }
      }
      return -1;
    };

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
      if (!parent || waypoints.length === 0) {
        return;
      }
      var scrollTop = parent.scrollTop;
      var scrollBottom = scrollTop + parent.offsetHeight;
      if (waypoints.length === 0 || scrollBottom === 0) {
        return;
      }
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

    $rootScope.$on('fontsLoaded', deferredCheckWaypoints);
    $rootScope.$on('fontsFiltered', deferredCheckWaypoints);
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

  mod.directive('textFitContainer', function($window, $document, Storage, util) {

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
          return parseInt($window.getComputedStyle(elements[0]).fontSize, 10) || 10;
        }

        function resetSize() {
          $scope.size = 'auto';
          fit();
        }

        function incrementSize(amt, shift) {
          var size = $scope.size, mult, shiftMult;

          if (!elements.length || !size) {
            return;
          }

          if (size === 'auto') {
            size = getSize();
          }

          shiftMult = shift ? 4 : 1;
          if (size <= 16) {
            mult = 1;
          } else if (size <= 32) {
            mult = 2;
          } else if (size <= 72) {
            mult = 4;
          } else {
            mult = 8;
          }
          $scope.size = Math.max(2, size + (amt * mult * shiftMult));
          fit();
        }

        function fit() {
          if (!elements.length) {
            return;
          }

          if ($scope.size != 'auto') {
            setSize($scope.size);
            checkBounds();
            return;
          }
          setSize();
          fontSize = getSize();
          while (canContinue()) {
            fontSize--;
            angular.forEach(elements, function(el) {
              el.style.fontSize = fontSize + 'px';
            });
          }
          checkBounds();
        }

        function checkBounds() {
          var overflowing = container.scrollHeight > container.clientHeight;
          $element.toggleClass('flex-gutter', !overflowing);
        }

        function canContinue() {
          return fontSize > MIN_SIZE && container.scrollHeight > container.clientHeight;
        }

        this.register = function(el) {
          elements.push(el);
        }

        this.unregister = function(el) {
          util.removeFromArray(elements, el);
          fit();
        }

        this.fit = util.debounce(fit);

        angular.element($window).on('resize', util.debounce(fit, 500));
        angular.element($window).on('orientationchange', util.debounce(fit, 500));

        Storage.setupAttribute($scope, 'size', 'auto');

        $document.on('keydown', function(evt) {
          if (evt.keyCode === 48) {
            resetSize();
            $scope.$apply();
          } else if (evt.keyCode === 187) {
            incrementSize(1, evt.shiftKey);
            $scope.$apply();
          } else if (evt.keyCode === 189) {
            incrementSize(-1, evt.shiftKey);
            $scope.$apply();
          }
        });

      }
    }
  });

  mod.directive('textFit', function($timeout) {

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
        scope.$on('$destroy', function(text) {
          textFitController.unregister(element[0]);
        });
      }
    }
  });

  mod.directive('dblclickEditing', function() {

    return {
      restrict: 'A',
      link: function(scope, element, attr) {

        var container = element.parent();

        element.on('blur', function(evt) {
          scope.editing = false;
          scope.$apply();
        });

        element.on('keydown', function(evt) {
          if (evt.keyCode === 27) {
            scope.editing = false;
            scope.$apply();
          }
        });

        container.on('click', function(evt) {
          evt.stopPropagation();
        });

        container.on('dblclick', function(evt) {
          scope.editing = true;
          evt.stopPropagation();
          scope.$apply();
          element[0].select();
        });

      }
    }
  });

  mod.directive('noClickBubble', function() {
    return {
      link: function(scope, element) {
        element.on('click', function(evt) {
          evt.stopPropagation();
        });
        element.on('dblclick', function(evt) {
          evt.stopPropagation();
        });
      }
    }
  });
})();
