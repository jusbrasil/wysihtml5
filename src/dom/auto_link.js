/**
 * Find urls in descendant text nodes of an element and auto-links them
 * Inspired by http://james.padolsey.com/javascript/find-and-replace-text-with-javascript/
 *
 * @param {Element} element Container element in which to search for urls
 *
 * @example
 *    <div id="text-container">Please click here: www.google.com</div>
 *    <script>wysihtml5.dom.autoLink(document.getElementById("text-container"));</script>
 */
(function(wysihtml5) {
  var /**
       * Don't auto-link urls that are contained in the following elements:
       */
      IGNORE_URLS_IN        = wysihtml5.lang.array(["CODE", "PRE", "A", "SCRIPT", "HEAD", "TITLE", "STYLE", "IFRAME"]),
      /**
       * revision 1:
       *    /(\S+\.{1}[^\s\,\.\!]+)/g
       *
       * revision 2:
       *    /(\b(((https?|ftp):\/\/)|(www\.))[-A-Z0-9+&@#\/%?=~_|!:,.;\[\]]*[-A-Z0-9+&@#\/%=~_|])/gim
       *
       * put this in the beginning if you don't wan't to match within a word
       *    (^|[\>\(\{\[\s\>])
       */
      URL_REG_EXP           = /((https?:\/\/|www\.)[^\s<]{3,}\.[^\s]{2,})/gi,
      TRAILING_CHAR_REG_EXP = /([^\w\/\-](,?))$/i,
      MAX_DISPLAY_LENGTH    = 100,
      BRACKETS              = { ")": "(", "]": "[", "}": "{" };

  function autoLink(element) {
    if (_hasParentThatShouldBeIgnored(element)) {
      return element;
    }

    if (element === element.ownerDocument.documentElement) {
      element = element.ownerDocument.body;
    }

    return _parseNode(element);
  }

  /**
   * This is basically a rebuild of
   * the rails auto_link_urls text helper
   */
  function _convertUrlsToLinks(str) {
    return str.replace(URL_REG_EXP, function(match, url) {
      var punctuation = (url.match(TRAILING_CHAR_REG_EXP) || [])[1] || "",
          opening     = BRACKETS[punctuation];
      url = url.replace(TRAILING_CHAR_REG_EXP, "");

      if (url.split(opening).length > url.split(punctuation).length) {
        url = url + punctuation;
        punctuation = "";
      }
      var realUrl    = url,
          displayUrl = url;
      if (url.length > MAX_DISPLAY_LENGTH) {
        displayUrl = displayUrl.substr(0, MAX_DISPLAY_LENGTH) + "...";
      }
      // Add http prefix if necessary
      if (realUrl.substr(0, 4) === "www.") {
        realUrl = "http://" + realUrl;
      }

      var vidsrc = _isVideoUrl(realUrl);
      if(!vidsrc){
        return '<a href="' + realUrl + '">' + displayUrl + '</a>' + punctuation;
      } else {
        return _getEmbedVideoHTML(realUrl, vidsrc);
      }
    });
  }

  //Checks if a given URL is an youtube video URL
  function _isYoutube(str){
    /*return /(https?:\/\/)?(youtu\.be\/[a-z0-9_-]+|(www\.)?youtube\.com\/(watch\?v=|embed\/)[0-9a-z_-]+)/i.test(str) ? 'youtube' : false;*/
    return /(?:http|https|)(?::\/\/|)(?:www.|)(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/ytscreeningroom\?v=|\/feeds\/api\/videos\/|\/user\S*[^\w\-\s]|\S*[^\w\-\s]))([\w\-]{11})[a-z0-9;:@?&%=+\/\$_.-]*/.test(str) ? 'youtube' : false;
  }

  //Checks if a given URL is a vimeo video URL
  function _isVimeo(str){
    return /(http:\/\/)?((www\.)?|player\.)vimeo\.com/.test(str) ? 'vimeo' : false;
  }

  //Checks if a given URL is a daily motion URL
  function _isDailyMotion(str){
    return /(http:\/\/)?(dai\.ly\/[a-z0-9]+|(www\.)?dailymotion\.com\/(embed\/)?video\/[a-z0-9]+)/mi.test(str) ? 'daily' : false;
  }

  //Checks if a given URL is a video URL
  function _isVideoUrl(str){
    return _isYoutube(str) || _isDailyMotion(str);
  }

  //Returns the video id from a given URL and a give video source (like youtube or vimeo)
  function _getVideoId(str, vidsrc){
    var provs = {
      'youtube': /(?:http|https|)(?::\/\/|)(?:www.|)(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/ytscreeningroom\?v=|\/feeds\/api\/videos\/|\/user\S*[^\w\-\s]|\S*[^\w\-\s]))([\w\-]{11})[a-z0-9;:@?&%=+\/\$_.-]*/,
      'daily': /video\/[a-z0-9-]+|(?!\/)[a-z0-9]+(?=\?)|(?!\/)[a-z0-9]+([^=0-9])$/mi,
      'vimeo': /[0-9]+(?=\?.+=.+|$)/mi
    }


    if(vidsrc == 'youtube'){
      var match_index = 1;
    } else {
      var match_index = 0;
    }

    return str.match(provs[vidsrc])[match_index].replace(/(embed\/|video\/|watch\?v\=)/,'');
  }

  //Returns the URL for embed video given a video source and the video id
  function _getVideoEmbedURL(vidsrc, vidid){
    var provs = {
      'youtube': 'http://www.youtube.com/embed/{{VIDID}}',
      'vimeo': 'http://player.vimeo.com/video/{{VIDID}}?title=0&amp;byline=0&amp;portrait=0',
      'daily': 'http://www.dailymotion.com/embed/video/{{VIDID}}'
    }

    return provs[vidsrc].replace('{{VIDID}}', vidid);
  }

  //Returns the iframe for a embedding a video
  function _getEmbedVideoHTML(str, vidsrc){
    var vidid = _getVideoId(str, vidsrc);

    return '<iframe src="'+_getVideoEmbedURL(vidsrc, vidid)+'" width="496px" height="278px">'+_getVideoEmbedURL(vidsrc, vidid)+'</iframe>';
  }

  /**
   * Creates or (if already cached) returns a temp element
   * for the given document object
   */
  function _getTempElement(context) {
    var tempElement = context._wysihtml5_tempElement;
    if (!tempElement) {
      tempElement = context._wysihtml5_tempElement = context.createElement("div");
    }
    return tempElement;
  }

  /**
   * Replaces the original text nodes with the newly auto-linked dom tree
   */
  function _wrapMatchesInNode(textNode) {
    var parentNode  = textNode.parentNode,
        nodeValue   = wysihtml5.lang.string(textNode.data).escapeHTML(),
        tempElement = _getTempElement(parentNode.ownerDocument);

    // We need to insert an empty/temporary <span /> to fix IE quirks
    // Elsewise IE would strip white space in the beginning
    tempElement.innerHTML = "<span></span>" + _convertUrlsToLinks(nodeValue);
    tempElement.removeChild(tempElement.firstChild);

    while (tempElement.firstChild) {
      // inserts tempElement.firstChild before textNode
      parentNode.insertBefore(tempElement.firstChild, textNode);
    }
    parentNode.removeChild(textNode);
  }

  function _hasParentThatShouldBeIgnored(node) {
    var nodeName;
    while (node.parentNode) {
      node = node.parentNode;
      nodeName = node.nodeName;
      if (IGNORE_URLS_IN.contains(nodeName)) {
        return true;
      } else if (nodeName === "body") {
        return false;
      }
    }
    return false;
  }

  function _parseNode(element) {
    if (IGNORE_URLS_IN.contains(element.nodeName)) {
      if(element.href && _isVideoUrl(element.href)) {
        var text = element.href;

        wysihtml5.dom.renameElement(element, 'span');
        element.innerText = element.href;
      } else {
        return;
      }
    }

    if (element.nodeType === wysihtml5.TEXT_NODE && element.data.match(URL_REG_EXP)) {
      _wrapMatchesInNode(element);
      return;
    }

    var childNodes        = wysihtml5.lang.array(element.childNodes).get(),
        childNodesLength  = childNodes.length,
        i                 = 0;

    for (; i<childNodesLength; i++) {
      _parseNode(childNodes[i]);
    }

    return element;
  }

  wysihtml5.dom.autoLink = autoLink;

  // Reveal url reg exp to the outside
  wysihtml5.dom.autoLink.URL_REG_EXP = URL_REG_EXP;
})(wysihtml5);
