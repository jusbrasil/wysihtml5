/**
 * Text Parser
 * Parses the text in a given node based on a given set of rules
 *
 * @deprecated Works but it's already unused. Too slow.
 *
 * @author Mateus Chagas (contato@mateuschagas.com.br) (http://github.com/matchs)
 */
wysihtml5.dom.textParser = {};
wysihtml5.dom.textParser.TEXT_PLACEMENT_MARKUP = '__#txt__';
wysihtml5.dom.textParser.TEXT_PLACEMENT_MARKUP_REGEX = new RegExp(wysihtml5.dom.textParser.TEXT_PLACEMENT_MARKUP+'$', 'gi');
wysihtml5.dom.textParser.PRESERVE_MARKUP = '{{PRESERVE}}';

/**
 * Wrote my own fold function. Didn't use native map or filter for old browser compatibility sake
 * For more about fold functions {@link http://learnyouahaskell.com/higher-order-functions#folds}
 *
 * @param array Set A set of anythin
 * @param {*} accum The initial value for folding, used for accumulate some value
 * @param function func A function that will receive accum and one item of the Set
 * @returns {*} The final accum value
 */
wysihtml5.dom.textParser.fold = function (Set, accum, func) {
  return (Set && Set.length > 0) ?
    this.fold(Set.slice(1, Set.length), func(accum, Set[0]), func) : accum;
};

/**
 * Applies different processing functions depending on the node type
 *
 * @param node
 * @param elementProcessor Function to be executed in case of the node being an elementNode
 * @param textProcessor Function to be executed in of the node being a text node
 * @returns {*}
 */
wysihtml5.dom.textParser.processNode = function(node, elementProcessor, textProcessor){
  switch(node.nodeType){
    case 1: // ELEMENT NODE
      return elementProcessor(node);
    case 3: // #TEXT-NODE
      return textProcessor(node);
  }
};

/**
 * Extracts the text from a given node added of a separator markup for each #text-node
 *
 * Ex.: <p> foo, bar baz <a href="http://www.sanger.dk">duh, dah, daz</a>
 * will return foo, bar baz__#txt__duh, dah, daz__#txt__
 *
 * @param node
 * @returns string
 */
wysihtml5.dom.textParser.extractText = function(node, preserve){
  var that = this;
  return that.processNode(node, function(cnode){
    return that.fold([].slice.call(cnode.childNodes, 0), '', function(text, currNode){
      return text + that.extractText(currNode, preserve);
    });
  }, function(cnode){
    return that.preserveMarkup(cnode.textContent, preserve) + that.TEXT_PLACEMENT_MARKUP;
  });
};


/**
 * Checks if a given text should or shouldn't be parsed. If it shouldn't the method stores the original text in a var a nd
 *
 * @param  string text
 * @param  regexp rule
 * @return string
 */
wysihtml5.dom.textParser.preserveMarkup = function(text, rule) {

  return rule !== undefined ? text.replace(rule, this.PRESERVE_MARKUP) : text;
}

/**
 * Extracts text that shold preserved from the
 *
 * @param node node
 * @param regexp preserve
 * @return array
 */
wysihtml5.dom.textParser.extractPreserved = function(node, preserve) {
  var that = this;
  return that.processNode(node, function(cnode){
    return that.fold([].slice.call(cnode.childNodes, 0), [], function(preserve_set, currNode){
      return preserve_set.concat(that.extractPreserved(currNode, preserve));
    });
  }, function(cnode){
    return preserve !== undefined && preserve.test(cnode.textContent) ? cnode.textContent.match(preserve) : [];
  });
}

/**
 * Returns a string with placement markups of the text nodes in a given node
 *
 * Ex.: <p> foo, bar baz <a href="http://www.sanger.dk">duh, dah, daz</a>
 * will return <p>__#txt__<a href="http://www.sanger.dk">__#txt__</a></p>
 *
 * @param node
 * @returns string
 */
wysihtml5.dom.textParser.extractNodeMarkup = function(node){
  var that = this;

  return that.processNode(node, function(node){
    return that.getNodeMarkupGuts(node);
  }, function(node){
    return that.TEXT_PLACEMENT_MARKUP;
  });
};

/**
 *
 *
 * @param node
 * @returns {string}
 */
wysihtml5.dom.textParser.getNodeMarkupGuts = function(node){
  var that = this,
      attr = node.attributes.length > 0 ? node.outerHTML.match(/ .*?(?=>)/)[0] : '';

  return !node.firstChild ? '<' + node.nodeName.toLowerCase() + attr + '>'
    : '<' + node.nodeName.toLowerCase() + attr + '>' + (function(){
      return that.fold([].slice.call(node.childNodes, 0), '', function(text, currNode){
        return text + that.extractNodeMarkup(currNode);
      });
    })() + '</' + node.nodeName.toLowerCase() + '>';
}


/**
 * Replace text with the preserved strings
 *
 * @param  array preserved_set  [description]
 * @param  string text [description]
 * @return string
 */
wysihtml5.dom.textParser.replacePreserved = function(preserved_set, text){
  var that = this;
  return that.fold(preserved_set, text, function(txt, preserved_item){
    return txt.replace(that.PRESERVE_MARKUP, preserved_item);
  });
}

/**
 * Applies the rules to a given string
 *
 * @param string text
 * @param array rules
 * @returns string
 */
wysihtml5.dom.textParser.applyRules = function(text, rules){
  var that = this;
  return (rules && rules.length > 0) ?
    that.applyRules(text.replace(rules[0].rule, rules[0].replace), rules.slice(1, rules.length)) : text;
};


/**
 * Parses the innerText of a given node according to a given set of rules but preserving its sub-nodes
 *
 * @param node node The node to be parsed
 * @param array rules The rules for parsing the node's text
 * @param regexp preserve The rule for pieces of text that mustn't be processed by the parser
 * @returns String Node's innerHTML after applying the rules
 */
wysihtml5.dom.textParser.parse = function(node, rules, preserve){
    var that = this;

    /** It's not elegant, I know =(. But it's easier to make it without having to iterate over the node three times. */
    var templateText = '';
    var preserved_set = [];
    var wholeText = that.fold([].slice.call(node.childNodes, 0), '', function(accum, currNode){//Removing the root node from the response
      templateText += that.extractNodeMarkup(currNode);
      preserved_set = preserved_set.concat(that.extractPreserved(currNode, preserve));
      return accum + that.extractText(currNode, preserve);
    });

    //Replacing the text back in its original position
    var text = (function foldTokens(tokenSet, template){
      return (tokenSet && tokenSet.length > 0) ?
        foldTokens(tokenSet.slice(1, tokenSet.length), template.replace(that.TEXT_PLACEMENT_MARKUP, tokenSet[0])) : template;

    })(
        that.applyRules(//Applying the rules to the text
          wholeText.replace(that.TEXT_PLACEMENT_MARKUP_REGEX,''),
          rules
        ).split(that.TEXT_PLACEMENT_MARKUP), //Splitting the resulting string

        templateText
      );

    //restoring preserved text
    return wysihtml5.dom.textParser.replacePreserved(preserved_set, text);
};
