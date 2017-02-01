(function(wysihtml5) {
  var dom       = wysihtml5.dom,
      browser   = wysihtml5.browser;

  var ALLOWED_EMPTY_NODES_REGEX = new RegExp("\<img|\<iframe|\<video|\<hr|\<canvas",'i');
  var ALLOWED_EMPTY_NODENAMES_REGEX = new RegExp("img|iframe|video|hr|canvas|br");

  wysihtml5.views.Composer = wysihtml5.views.View.extend(
    /** @scope wysihtml5.views.Composer.prototype */ {
    name: "composer",

    // Needed for firefox in order to display a proper caret in an empty contentEditable
    CARET_HACK: "<br>",

    constructor: function(parent, textareaElement, config) {
      this.base(parent, textareaElement, config);
      this.textarea = this.parent.textarea;
      this._initSandbox();
    },

    clear: function() {
      this.element.innerHTML = browser.displaysCaretInEmptyContentEditableCorrectly() ? "" : this.CARET_HACK;
    },

    getValue: function(parse) {
      var value = this.isEmpty() ? "" : wysihtml5.quirks.getCorrectInnerHTML(this.element);

      if (parse) {
        value = this.parent.parse(value);
      }

      return value;
    },

    setValue: function(html, parse) {
      if (parse) {
        html = this.parent.parse(html);
      }

      try {
        this.element.innerHTML = html;
      } catch (e) {
        this.element.innerText = html;
      }
    },

    show: function() {
      this.iframe.style.display = this._displayStyle || "";

      if (!this.textarea.element.disabled) {
        // Firefox needs this, otherwise contentEditable becomes uneditable
        this.disable();
        this.enable();
      }
    },

    hide: function() {
      this._displayStyle = dom.getStyle("display").from(this.iframe);
      if (this._displayStyle === "none") {
        this._displayStyle = null;
      }
      this.iframe.style.display = "none";
    },

    disable: function() {
      this.parent.fire("disable:composer");
      this.element.removeAttribute("contentEditable");
    },

    enable: function() {
      this.parent.fire("enable:composer");
      this.element.setAttribute("contentEditable", "true");
    },

    focus: function(setToEnd) {
      // IE 8 fires the focus event after .focus()
      // This is needed by our simulate_placeholder.js to work
      // therefore we clear it ourselves this time
      if (wysihtml5.browser.doesAsyncFocus() && this.hasPlaceholderSet()) {
        this.clear();
      }

      this.base();

      var lastChild = this.element.lastChild;
      if (setToEnd && lastChild) {
        if (lastChild.nodeName === "BR") {
          this.selection.setBefore(this.element.lastChild);
        } else {
          this.selection.setAfter(this.element.lastChild);
        }
      }
    },

    getTextContent: function() {
      return dom.getTextContent(this.element);
    },

    hasPlaceholderSet: function() {
      return this.getTextContent() == this.textarea.element.getAttribute("placeholder") && this.placeholderSet;
    },

    isEmpty: function() {
      var innerHTML = this.element.innerHTML.toLowerCase();
      return innerHTML === ""            ||
             innerHTML === "<br>"        ||
             innerHTML === "<p></p>"     ||
             innerHTML === "<p><br></p>" ||
             this.hasPlaceholderSet();
    },

    _initSandbox: function() {
      var that = this;

      this.sandbox = new dom.Sandbox(function() {
        that._create();
      }, {
        stylesheets:  this.config.stylesheets
      });
      this.iframe  = this.sandbox.getIframe();

      var textareaElement = this.textarea.element;
      dom.insert(this.iframe).after(textareaElement);

      // Create hidden field which tells the server after submit, that the user used an wysiwyg editor
      if (textareaElement.form) {
        var hiddenField = document.createElement("input");
        hiddenField.type   = "hidden";
        hiddenField.name   = "_wysihtml5_mode";
        hiddenField.value  = 1;
        dom.insert(hiddenField).after(textareaElement);
      }
    },

    _create: function() {
      var that = this;

      this.doc                = this.sandbox.getDocument();
      this.element            = this.doc.body;
      this.textarea           = this.parent.textarea;
      this.element.innerHTML  = this.textarea.getValue(true);

      // Make sure our selection handler is ready
      this.selection = new wysihtml5.Selection(this.parent);

      // Make sure commands dispatcher is ready
      this.commands  = new wysihtml5.Commands(this.parent);

      dom.copyAttributes([
        "className", "spellcheck", "title", "lang", "dir", "accessKey"
      ]).from(this.textarea.element).to(this.element);

      dom.addClass(this.element, this.config.composerClassName);
      //
      // // Make the editor look like the original textarea, by syncing styles
      if (this.config.style) {
        this.style();
      }

      this.observe();

      var name = this.config.name;
      if (name) {
        dom.addClass(this.element, name);
        dom.addClass(this.iframe, name);
      }

      this.enable();

      if (this.textarea.element.disabled) {
        this.disable();
      }

      // Simulate html5 placeholder attribute on contentEditable element
      var placeholderText = typeof(this.config.placeholder) === "string"
        ? this.config.placeholder
        : this.textarea.element.getAttribute("placeholder");
      if (placeholderText) {
        dom.simulatePlaceholder(this.parent, this, placeholderText);
      }

      // Make sure that the browser avoids using inline styles whenever possible
      this.commands.exec("styleWithCSS", false);

      this._initAutoLinking();
      this._initObjectResizing();
      this._initUndoManager();
      this._initLineBreaking();

      if(that.config.titleMode){
        this._initAutoFormatting();
      }

      if(that.config.autoCheckCase){
        this._initCheckCase();
      }

      // Puts the caret immediately after the given node
      this.repositionCaretAt = function(element){
        if (!browser.displaysCaretInEmptyContentEditableCorrectly()) {
          if(element.innerHTML == ""){
            element.innerHTML == "<br>";
          }

          that.selection.setBefore(element.firstChild);
        } else {
          that.selection.selectNode(element, true);
        }

        return element;
      }

      this.repositionCaretAtEndOf = function(element){
        element.focus();
        var range = that.selection.getRange().cloneRange();
        range.selectNodeContents(element);
        range.collapse(false);
        var sel = that.selection.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      };

      //@fixme Refactor to use document fragments for performance improvement
      // Inserts a set of nodes sequentially after currentNode
      this.insertNodes = function(currentNode, nodes){
        if(nodes.length <= 0) {
          return currentNode;
        }
        currentNode.parentNode.insertBefore(nodes[0], currentNode.nextSibling);
        return that.insertNodes(nodes[0], nodes.slice(1, nodes.length));
      }

      //@fixme Refactor to use document fragments for performance improvement
      // Creates a new empty <p> element
      this.makeEmptyParagraph = function(){
        var p = that.doc.createElement('p');
        p.appendChild(that.doc.createElement('br'));

        return p;
      }

      //@fixme Refactor to use document fragments for performance improvement
      // Replaces a given node with a set of given nodes
      this.replaceNodeWith = function(currentNode, nodes) {
        var node =  that.insertNodes(currentNode, nodes);
        currentNode.parentNode.removeChild(currentNode);

        return node;
      }

      /*this.nodeIsEmpty = function(node){
        var innerHTML = node.innerHTML;
        var innerText = wysihtml5.dom.getTextContent(node);

        return (innerText.replace(/\s/g,'').length == 0) && (innerHTML !== undefined && !ALLOWED_EMPTY_NODES_REGEX.test(innerHTML));
      }*/
      this.nodeIsEmpty = function(node){
        switch(node.nodeType){
          case wysihtml5.DOC_FRAGMENT_NODE: //#document-fragment
            var res = true;
            for(var i=0; i< node.childNodes.length; i++){
              res = res && _nodeIsEmpty(node.childNodes[i]);
            }
            return res;

          case wysihtml5.ELEMENT_NODE: //element
            var innerHTML = node.innerHTML;
            var innerText = wysihtml5.dom.getTextContent(node);
            return (!ALLOWED_EMPTY_NODENAMES_REGEX.test(node.nodeName.toLowerCase()))
              && (innerText.replace(/\s/g,'').length == 0)
              && (innerHTML !== undefined && !ALLOWED_EMPTY_NODES_REGEX.test(innerHTML));

          case wysihtml5.TEXT_NODE: //#text
            return node.wholeText.replace(/\s/g,'').length == 0;
        }
      }

      // Simulate html5 autofocus on contentEditable element
      // This doesn't work on IOS (5.1.1)
      if ((this.textarea.element.hasAttribute("autofocus") || document.querySelector(":focus") == this.textarea.element) && !browser.isIos()) {
        setTimeout(function() { that.focus(true); }, 100);
      }

      // IE sometimes leaves a single paragraph, which can't be removed by the user
      if (!browser.clearsContentEditableCorrectly()) {
        wysihtml5.quirks.ensureProperClearing(this);
      }

      // Set up a sync that makes sure that textarea and editor have the same content
      if (this.initSync && this.config.sync) {
        this.initSync();
      }

      // Okay hide the textarea, we are ready to go
      this.textarea.hide();

      // Fire global (before-)load event
      this.parent.fire("beforeload").fire("load");
    },

    _initAutoLinking: function() {
      var that                           = this,
          supportsDisablingOfAutoLinking = browser.canDisableAutoLinking(),
          supportsAutoLinking            = browser.doesAutoLinkingInContentEditable();
      if (supportsDisablingOfAutoLinking) {
        this.commands.exec("autoUrlDetect", false);
      }

      if (!this.config.autoLink) {
        return;
      }

      function doAutoLink(){
        if (dom.getTextContent(that.element).match(dom.autoLink.URL_REG_EXP)) {
          that.selection.executeAndRestore(function(startContainer, endContainer) {
            dom.autoLink(endContainer.parentNode);
            that.doResize();
          });
        }
      }

      // Only do the auto linking by ourselves when the browser doesn't support auto linking
      // OR when he supports auto linking but we were able to turn it off (IE9+)
      if (!supportsAutoLinking || (supportsAutoLinking && supportsDisablingOfAutoLinking)) {
        this.parent.on("newword:composer", doAutoLink);
        this.parent.on("paste:composer", doAutoLink);
        this.parent.on("enable:composer", doAutoLink);
        this.parent.on("beforeload", doAutoLink);
        this.parent.on("load", doAutoLink);


        dom.observe(this.element, ["blur", "focus", "load", "beforeload"], function() {
          dom.autoLink(that.element);
          that.doResize();
        });
      }

      // Assuming we have the following:
      //  <a href="http://www.google.de">http://www.google.de</a>
      // If a user now changes the url in the innerHTML we want to make sure that
      // it's synchronized with the href attribute (as long as the innerHTML is still a url)
      var // Use a live NodeList to check whether there are any links in the document
          links           = this.sandbox.getDocument().getElementsByTagName("a"),
          // The autoLink helper method reveals a reg exp to detect correct urls
          urlRegExp       = dom.autoLink.URL_REG_EXP,
          getTextContent  = function(element) {
            var textContent = wysihtml5.lang.string(dom.getTextContent(element)).trim();
            if (textContent.substr(0, 4) === "www.") {
              textContent = "http://" + textContent;
            }
            return textContent;
          };

      dom.observe(this.element, "keydown", function(event) {
        if (!links.length) {
          return;
        }

        var selectedNode = that.selection.getSelectedNode(event.target.ownerDocument),
            link         = dom.getParentElement(selectedNode, { nodeName: "A" }, 4),
            textContent;

        if (!link) {
          return;
        }

        textContent = getTextContent(link);
        // keydown is fired before the actual content is changed
        // therefore we set a timeout to change the href
        setTimeout(function() {
          var newTextContent = getTextContent(link);
          if (newTextContent === textContent) {
            return;
          }

          // Only set href when new href looks like a valid url
          if (newTextContent.match(urlRegExp)) {
            link.setAttribute("href", newTextContent);
          }
        }, 0);
      });
    },

    _initObjectResizing: function() {
      this.commands.exec("enableObjectResizing", true);

      // IE sets inline styles after resizing objects
      // The following lines make sure that the width/height css properties
      // are copied over to the width/height attributes
      if (browser.supportsEvent("resizeend")) {
        var properties        = ["width", "height"],
            propertiesLength  = properties.length,
            element           = this.element;

        dom.observe(element, "resizeend", function(event) {
          var target = event.target || event.srcElement,
              style  = target.style,
              i      = 0,
              property;

          if (target.nodeName !== "IMG") {
            return;
          }

          for (; i<propertiesLength; i++) {
            property = properties[i];
            if (style[property]) {
              target.setAttribute(property, parseInt(style[property], 10));
              style[property] = "";
            }
          }

          // After resizing IE sometimes forgets to remove the old resize handles
          wysihtml5.quirks.redraw(element);
        });
      }
    },

    _initUndoManager: function() {
      this.undoManager = new wysihtml5.UndoManager(this.parent);
    },

    _initLineBreaking: function() {
      var that                              = this,
          USE_NATIVE_LINE_BREAK_INSIDE_TAGS = ["LI", "P", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE"],
          LIST_TAGS                         = ["UL", "OL", "MENU"];

      function adjust(selectedNode) {
        var parentElement = dom.getParentElement(selectedNode, { nodeName: ["P", "DIV"] }, 2);
        if (parentElement) {
          that.selection.executeAndRestore(function() {
            if (that.config.useLineBreaks) {
              dom.replaceWithChildNodes(parentElement);
            } else if (parentElement.nodeName !== "P") {
              dom.renameElement(parentElement, "p");
            }
          });
        }
      }

      //Checks if should put an <hr> and returns in wich element or false
      var shouldPutHR = (function(){
        if(that.config.autoInsertHR){
          return function (currentNode){
            var nextSibling = currentNode.nextElementSibling || false,
              prevSibling = currentNode.previousElementSibling || false,
              parentNode = currentNode.parentNode || false;

            if(parentNode){
              switch (parentNode.nodeName){
                case "BLOCKQUOTE":
                  return false;
                case "DIV":
                  dom.replaceWithChildNodes(parentNode);
                  break;
              }
            }

            if (that.nodeIsEmpty(currentNode) && (nextSibling && nextSibling.nodeName == "HR" || prevSibling && prevSibling.nodeName == "HR")) { //If there's one hr already
              return false;
            } else if(prevSibling && that.nodeIsEmpty(prevSibling) && prevSibling.nodeName !== "HR"){
              if(!prevSibling.previousElementSibling || prevSibling.previousElementSibling.nodeName !== "HR") {
                return prevSibling;
              } else {
                return false;
              }
            } else if(nextSibling && that.nodeIsEmpty(nextSibling) && nextSibling.nodeName !== "HR") {
              if(!nextSibling.nextElementSibling || nextSibling.nextElementSibling.nodeName !== "HR") {
                return nextSibling;
              } else {
                return false;
              }
            } else if(!that.nodeIsEmpty(currentNode)){
              return false;
            }

            return currentNode;
          }
        } else {
          return function(currentNode){
            return false;
          }
        }
      })();

      function removeEmptySiblingParagraph(element, position) {
        position = position || 'next';
        var sibling = (position === 'next') ? element.nextElementSibling : element.previousElementSibling;
        if (sibling && sibling.nodeName === 'P' && removeHTMLTagsFromString(sibling.innerHTML) === '') {
          sibling.remove();
        }
      }

      function removeHTMLTagsFromString(html, tag, replaceTo) {
        replaceTo = replaceTo || '';
        var exp = new RegExp('<' + (tag || '') + '[^>]*>', 'g');
        return html.replace(exp, replaceTo);
      }

      function cleanTags(blockElement, tag, replaceTo) {
        if (blockElement.nodeName === 'P') {
          blockElement.innerHTML = removeHTMLTagsFromString(blockElement.innerHTML, tag, replaceTo);
        }
      }

      function parseElement(blockElement, event){
        var keyCode = event.keyCode;

        // Jump to next element on enter (excepts shift-enter, appears ok) [firefox fallback]
        if (wysihtml5.browser.detectsReturnKeydownAfterItIsDone() && keyCode == wysihtml5.ENTER_KEY && !event.shiftKey) {
          blockElement = blockElement.previousElementSibling || blockElement;
        }

        // General - Parse element
        if(!that.nodeIsEmpty(blockElement) && keyCode === wysihtml5.ENTER_KEY){
          blockElement.innerHTML = dom.parse(blockElement, that.config.parserRules).innerHTML;
        }

        // Execute the firefox Fallback
        // Firefox sometimes captures the RETURN keydown event after the next element is created
        if (!wysihtml5.browser.hasIframeFocusIssue() && wysihtml5.browser.detectsReturnKeydownAfterItIsDone()) {
          var nextEl = blockElement.nextElementSibling,
            removeBR = function(el) {
              // replace <br type="_moz"> to just <br>
              cleanTags(el, 'br', '<br>')
            };

          // Parse <h3> element on enter
          if (keyCode === wysihtml5.ENTER_KEY && blockElement.nodeName.match(/^H[1-6]$/)) {
            var _h3 = that.selection.getSelectedNode().previousElementSibling;
            _h3.innerHTML = dom.parse(_h3, that.config.parserRules).innerHTML;
          }

          // Remove <br> in paragraphs elements on backspace and enter
          if (keyCode === wysihtml5.ENTER_KEY) {
            removeBR(blockElement);
            if (nextEl) {
              removeBR(nextEl);
            }
          } else if (keyCode === wysihtml5.BACKSPACE_KEY && nextEl && removeHTMLTagsFromString(nextEl.innerHTML) === '') {
            removeBR(nextEl);
          }
        }
      }

      if (!this.config.useLineBreaks) {
        dom.observe(this.element, ["focus", "keydown"], function() {
          if (that.isEmpty()) {
            var paragraph = that.doc.createElement("P");
            that.element.innerHTML = "";
            that.element.appendChild(paragraph);
            if (!browser.displaysCaretInEmptyContentEditableCorrectly()) {
              paragraph.innerHTML = "<br>";
              that.selection.setBefore(paragraph.firstChild);
            } else {
              that.selection.selectNode(paragraph, true);
            }
          }
        });
      }

      // Under certain circumstances Chrome + Safari create nested <p> or <hX> tags after paste
      // Inserting an invisible white space in front of it fixes the issue
      if (browser.createsNestedInvalidMarkupAfterPaste()) {
        dom.observe(this.element, "paste", function(event) {
          var invisibleSpace = that.doc.createTextNode(wysihtml5.INVISIBLE_SPACE);
          that.selection.insertNode(invisibleSpace);
        });
      }


      // Remove the br from paragraph when space key is pressed
      // Firefox always inserts the br on space
      if (browser.detectsReturnKeydownAfterItIsDone()) {
        dom.observe(this.doc, "keyup", function(event) {
          var keyCode = event.keyCode,
            _el = that.selection.getSelectedNode();
          if (_el.nodeType === wysihtml5.TEXT_NODE
            && _el.textContent.slice(-2).slice(0,-1) === ' '
            && !event.shiftKey
            && keyCode !== wysihtml5.ENTER_KEY
            && keyCode !== wysihtml5.BACKSPACE_KEY) {

            _el.parentNode.innerHTML = removeHTMLTagsFromString(_el.parentNode.innerHTML, 'br');
            that.repositionCaretAtEndOf(that.selection.getSelectedNode());
          }
        });
      }

      dom.observe(this.doc, "keydown", function(event) {
        var keyCode = event.keyCode;

        // [firefox fallback]
        if (browser.detectsReturnKeydownAfterItIsDone()) {
          var _el = that.selection.getSelectedNode()
          // Remove the br from paragraph on type the first char
          if (keyCode !== wysihtml5.ENTER_KEY && _el.nodeName === 'P') {
            var cleanHTML = removeHTMLTagsFromString(_el.innerHTML, 'br');
            if (cleanHTML === '') {
              _el.innerHTML = cleanHTML;
            }
          }
        }

        if(that.config.titleMode && keyCode === wysihtml5.ENTER_KEY){
          event.preventDefault();
          return;
        }

        if (keyCode !== wysihtml5.ENTER_KEY && event.shiftKey) {
          return;
        }

        if (keyCode !== wysihtml5.ENTER_KEY && keyCode !== wysihtml5.BACKSPACE_KEY) {
          return;
        }

        var removeEmptySiblingParagraphFallback = function(el, position) {
          setTimeout(function() {
            // Remove empty paragraph after the created HR [firefox fallback]
            removeEmptySiblingParagraph(el, position);
          },0);
        }

        var blockElement = dom.getParentElement(that.selection.getSelectedNode(), { nodeName: USE_NATIVE_LINE_BREAK_INSIDE_TAGS }, 4);
        if (blockElement) {
          if(event.shiftKey && event.keyCode == wysihtml5.ENTER_KEY) {
            event.preventDefault();
            that.repositionCaretAt(that.insertNodes(blockElement, [ that.makeEmptyParagraph()]));
          }
          // firefox fallback
          if(browser.detectsReturnKeydownAfterItIsDone()) {
            var TAGS_COULD_BE_REMOVE = ['HR', 'IFRAME'];

            var persistRemove = function(el) {
              setTimeout(function() {
                el = el.previousElementSibling;
                if (rangy.dom.arrayContains(TAGS_COULD_BE_REMOVE, el.nodeName)) {
                  el.remove();
                }
              });
            }

            // Prevent delete root paragraph on backspace
            if (event.keyCode === wysihtml5.BACKSPACE_KEY && that.isEmpty()) {
              event.preventDefault();
            }
            // Force remove elements on backspace
            else if (event.keyCode === wysihtml5.BACKSPACE_KEY) {
              var _prev = blockElement.previousElementSibling,
                _prevNodes = (_prev && _prev.previousElementSibling) ? _prev.previousElementSibling.childNodes: [],
                arrayContains = rangy.dom.arrayContains;
              // Remove HL from sibling
              if (blockElement
                && _prev
                && removeHTMLTagsFromString(blockElement.innerHTML) === ''
                && arrayContains(TAGS_COULD_BE_REMOVE, _prev.nodeName)) {

                if (_prev.previousElementSibling
                  && _prevNodes.length
                  && _prevNodes[0].nodeName === 'IFRAME') {
                  _prev.outerHTML = that.makeEmptyParagraph().outerHTML;
                } else {
                  _prev.remove();
                }
              }
              // Remove HL from list
              if (arrayContains(LIST_TAGS, blockElement.parentNode.nodeName)
                && blockElement.parentNode.childNodes.length === 1
                && removeHTMLTagsFromString(blockElement.innerHTML) === ''
                && arrayContains(TAGS_COULD_BE_REMOVE, blockElement.parentNode.previousElementSibling.nodeName)) {
                blockElement.parentNode.previousElementSibling.remove();
              }
              // Remove iframe
              if (blockElement
                && _prev
                && _prev.childNodes.length
                && removeHTMLTagsFromString(blockElement.innerHTML) === ''
                && arrayContains(TAGS_COULD_BE_REMOVE, _prev.childNodes[0].nodeName)) {
                persistRemove(_prev);
                _prev.remove();
              }
              // Remove iframe inside the your paragraph
              if (blockElement
                && blockElement.nodeName === 'P'
                && blockElement.childNodes.length
                && blockElement.childNodes[0].nodeName === 'IFRAME') {
                blockElement.childNodes[0].remove();
              }
            }
          }

          if(browser.insertsLineBreaksOnReturn() && !browser.detectsReturnKeydownAfterItIsDone()){//IE case
            parseElement(blockElement, event);
          }

          setTimeout(function() {
            // Unwrap paragraph after leaving a list or a H1-6
            var selectedNode = that.selection.getSelectedNode(),
                list;

            if (blockElement.nodeName === "LI") {
              if (!selectedNode) {
                return;
              }

              list = dom.getParentElement(selectedNode, { nodeName: LIST_TAGS }, 2);

              if (!list) {
                adjust(selectedNode);
              }
            }

            if(!browser.hasIframeFocusIssue()){//General case
              parseElement(blockElement, event);
            }

            if (keyCode === wysihtml5.ENTER_KEY && blockElement.nodeName.match(/^H[1-6]$/)) {
              adjust(selectedNode);
            }
          }, 0);
          return;
        } else {
          // [firefox fallback]
          if (browser.detectsReturnKeydownAfterItIsDone() && keyCode !== wysihtml5.BACKSPACE_KEY) {
            var _body = that.selection.getSelectedNode();
            _body.innerHTML = wysihtml5.dom.parse(_body, that.config.parserRules).innerHTML;
            // create a paragraph on breaked cursor
            if (keyCode === wysihtml5.ENTER_KEY) {
              that.repositionCaretAt(_body.appendChild(that.makeEmptyParagraph()));
            }
            // reposition the cursor to last paragraph on breaked cursor
            else {
              var children = _body.childNodes,
                firstP = that._isSiblingOfA(children[children.length - 1], 'P');
              if (firstP) {
                that.repositionCaretAtEndOf(firstP);
              }
            }
          }
        }

        if (that.config.useLineBreaks && keyCode === wysihtml5.ENTER_KEY && !wysihtml5.browser.insertsLineBreaksOnReturn()) {
          that.commands.exec("insertLineBreak");
          event.preventDefault();
        }
      });
    },

    _initAutoFormatting: function () {
      var that                              = this,
        USE_NATIVE_LINE_BREAK_INSIDE_TAGS = ["LI", "P", "H1", "H2", "H3", "H4", "H5", "H6"];

      dom.observe(this.element, ["blur"],function(){
        var node = dom.getParentElement(that.selection.getSelectedNode(), { nodeName: USE_NATIVE_LINE_BREAK_INSIDE_TAGS }, 4);
        if(node){
          node.innerHTML = node.innerHTML.replace(/^(&nbsp;)+|(&nbsp;)+$/g,'').replace(/^\s*[a-zçáàéèíìóòúùñãõüïâêîôû]/,function(match){
              return match.toUpperCase();
          });
        }
      });
    },

    _initCheckCase: function () {
      var that = this;
      dom.observe(this.element, ["keydown", "blur"], function (event) {

        if (event.type == 'blur' || event.keyCode == wysihtml5.ENTER_KEY) {
          var text = dom.getTextContent(that.element);

          var match = text.match(/[A-ZÇÁÀÉÈÍÌÓÒÚÙÑÃÕÜÏÂÊÎÔÛ]/g);
          var nUpper = match ? match.length : 0;

          var upperRatio = nUpper / text.length;
          var ratios = that.config.alertUpperRatio;

          for(var i =0; i < ratios.length; i++){
            if (upperRatio > ratios[i]) {
              that.parent.fire('alertUpper:composer', {
                ratio:ratios[i]
              });
              return;
            }
          }

          that.parent.fire('alertUpperSafe:composer');
        }
      });
    }
  });
})(wysihtml5);
