import * as utils from './utils';
import LD from './LanguageDetector';

export var LanguageDetector = LD;

export function handle(i18next, options = {}) {
  return function(req, res, next) {
    let ignores = options.ignoreRoutes instanceof Array&&options.ignoreRoutes || [];
    for (var i=0;i< ignores.length;i++){
      if (req.path.indexOf(ignores[i]) > -1) return next();
    }

    let lng = req.lng;
    if (!req.lng && i18next.services.languageDetector) lng = i18next.services.languageDetector.detect(req, res);

    // set locale
    req.language = req.locale = req.lng = lng || i18next.options.fallbackLng[0];
    req.languages = i18next.services.languageUtils.toResolveHierarchy(lng);

    if(req.i18nextLookupName === 'path' && options.removeLngFromUrl) {
      req.url = utils.removeLngFromUrl(req.url, i18next.services.languageDetector.options.lookupFromPathIndex);
    }

    // assert t function returns always translation
    // in given lng inside this request
    let t = function(key, options) {
      options = options || {};
      if (typeof options !== 'object' && i18next.options.overloadTranslationOptionHandler && typeof i18next.options.overloadTranslationOptionHandler === 'function') {
        options = i18next.options.overloadTranslationOptionHandler(arguments);
      }
      options.lng = options.lng || req.lng;
      return i18next.t(key, options);
    };

    let exists = function(key, options) {
      options = options || {};
      options.lng = options.lng || req.lng;
      return i18next.exists(key, options);
    };

    let i18n = {
      t: t,
      exists: exists,
      dir: function(lng) { return i18next.dir(lng); },
      changeLanguage: function(lng) {
        req.language = req.locale = req.lng = lng;
        req.languages = i18next.services.languageUtils.toResolveHierarchy(lng);
      },
      language: lng
    };

    // assert for req
    req.i18n = i18n;
    req.t = req.t || t;

    // assert for res -> template
    if (res.locals) {
      res.locals.t = t;
      res.locals.exists = exists;
      res.locals.i18n = i18n;
      res.locals.language = lng;
      res.locals.languageDir = i18next.dir(lng);
    }

    if (i18next.services.languageDetector) i18next.services.languageDetector.cacheUserLanguage(req, res, lng);

    // load resources
    i18next.loadLanguages(req.lng, function() {
      next();
    });
  };
};

export function getResourcesHandler(i18next, options) {
  options = options || {};
  let maxAge = options.maxAge || 60 * 60 * 24 * 30;

  return function(req, res) {
    if (!i18next.services.backendConnector) return res.status(404).send('i18next-express-middleware:: no backend configured');

    let resources = {};

    res.contentType('json');
    if (options.cache !== undefined ? options.cache : process.env.NODE_ENV === 'production') {
      res.header('Cache-Control', 'public, max-age=' + maxAge);
      res.header('Expires', (new Date(new Date().getTime() + maxAge * 1000)).toUTCString());
    } else {
      res.header('Pragma', 'no-cache');
      res.header('Cache-Control', 'no-cache');
    }

    let languages = req.query[options.lngParam || 'lng'] ? req.query[options.lngParam || 'lng'].split(' ') : [];
    let namespaces = req.query[options.nsParam || 'ns'] ? req.query[options.nsParam || 'ns'].split(' ') : [];

    // extend ns
    namespaces.forEach(ns => {
      if (i18next.options.ns && i18next.options.ns.indexOf(ns) < 0) i18next.options.ns.push(ns);
    });

    i18next.services.backendConnector.load(languages, namespaces, function() {
      languages.forEach(lng => {
        namespaces.forEach(ns => {
          utils.setPath(resources, [lng, ns], i18next.getResourceBundle(lng, ns));
        });
      });

      res.send(resources);
    });
  };
};

export function missingKeyHandler(i18next, options) {
  options = options || {};

  return function(req, res) {
    let lng = req.params[options.lngParam || 'lng'];
    let ns = req.params[options.nsParam || 'ns'];

    if (!i18next.services.backendConnector) return res.status(404).send('i18next-express-middleware:: no backend configured');

    for (var m in req.body) {
      i18next.services.backendConnector.saveMissing([lng], ns, m, req.body[m]);
    }
    res.send('ok');
  };
};

function addRoute(i18next, route, lngs, app, verb, fc) {
  if (typeof verb === 'function') {
    fc = verb;
    verb = 'get';
  }

  // Combine `fc` and possible more callbacks to one array
  var callbacks = [fc].concat(Array.prototype.slice.call(arguments, 6));

  for (var i = 0, li = lngs.length; i < li; i++) {
    var parts = String(route).split('/');
    var locRoute = [];
    for (var y = 0, ly = parts.length; y < ly; y++) {
      var part = parts[y];
      // if the route includes the parameter :lng
      // this is replaced with the value of the language
      if (part === ':lng') {
        locRoute.push(lngs[i]);
      } else if (part.indexOf(':') === 0 || part === '') {
        locRoute.push(part);
      } else {
        locRoute.push(i18next.t(part, { lng: lngs[i] }));
      }
    }

    var routes = [locRoute.join('/')];
    app[verb || 'get'].apply(app, routes.concat(callbacks));
  }
};