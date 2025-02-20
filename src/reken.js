'use strict';

/*
 * reken.js - copyright Henry van den Broek, 2021-2022
 */

/*
* Reken supports the following DOM databindings
* - data-text: Update the textContent with the evaluated template string.
* - data-html: Update the innerHTML with the evaluated string. Note data- bindings in the HTML will be ignored 
* - data-value: Bind a javascript variable to an input control and adds a default change or update listener:
*   * input types: text, number have a change listener and have respective text and number values.
*   * input type: range have an update! listener and returns a number value
*   * checkbox: has change listener and takes a boolean, if multiple checkboxes are grouped by the name attribute it takes an array
*   * radio: has a change listener and takes a boolean, if multiple are grouped by the names attribute it takes a string.
*   * file: value is read-only and after a file (JSON) upload will contain the File object with attributes: name, size, lastModified (in ms), type and data containing the deserialized JSON.
*   *       an optional transform function reference can be provided, and will be called with the file content string and the File object. It should return the deserialized object. For example to parse XML data.
* - data-style: Update the style attribute with a an evaluated template string.
* - data-class: Takes a classname and an boolean expression that resolves in adding the classname when true and removing when false. If not boolean expression if provided the classname with be resolved into a boolean expression.
* - data-if: Takes a boolean expression, when true the element is shown, false the element is hidden (display:none). if classname provide before expression, the class is added/removed to element instead of toggling the display property.
* - data-route: Takes a path as an argument. When the path matches the location hash (the value after the first # value) the element will be visible otherwise not. An optional class name can be provided separated by a colon. if the hash matches, the class is set on the element. The path can also be a variable by preceding it with a # value. In that case the variable will be initialized with the matching hash value.
* - data-on: Takes a eventName following by js code that gets executed in the event. with the variable e the event details are made available.
* - data-for: Takes a var name following by a iterating javascript iterable object or a number. The first child of the element containing data-for will be replicated with the number of the elements in the iterable object or the number of times specifed. in the for loop the var element will contain property index and with an iterable object the item property. Nested loops a are allowed.
* - data-rest: Takes a javascript variable and a rest service JSON endpoint. Once the rest service is resolved the javascript variable contains the object representing the json. An optional property path in the resultsset can be specified. When the url changes the rest call gets executed again. The url can is an evaluated template string. That is how you can parameterize your rest calls.
* - data-rest-options: Takes a javascript variable with options to pass into the rest fetch call.
* - data-calc: Set this attribute on an script tag that needs to be excuted everytime there is a model update. Use for example to recalculate formulas.
* - data-component: Define and reference a component. Components can have members vars by defining them with "let varname = value" and component methods for internal use. by defining a script block in the component. To reexecute component state for every event add  script block with the calc attribute.
* - data-attr-*: Set element with attr value. If the attribute is a boolean attr eg. disabled, read-only; the value is evaluated as a boolean at the attr will be added it evaluates to true. 
* - data-arg-*: Define component arguments. Values bind to the argument can be updated by the component.
* - data-bind-*: Bind variable to a component binding. Values bind to the argument can be updated by the component.
* - data-include: Include (import) external HTML into the current DOM. 
* - data-timer: Execute code after a specific amount of time.
* - data-interval: Repeatedly executes code at a specific intervals.
*/
{   
    const reken = {}
    reken.version = '0.8.4';
    reken.routing_path;

    let componentRegistry = {}
    let classRegistry = {}
    let generatedClass = {}

    const isServerGenerated = () => typeof rkn_server_generated !== 'undefined' && rkn_server_generated
    const doGenerateCode = () => typeof rkn_generate_code !== 'undefined' && rkn_generate_code
    let booleanAttrs = [
        'allowfullscreen',
        'allowpaymentrequest',
        'async',
        'autofocus',
        'autoplay',
        'checked',
        'controls',
        'default',
        'defer',
        'disabled',
        'formnovalidate',
        'hidden',
        'ismap',
        'itemscope',
        'loop',
        'multiple',
        'muted',
        'nomodule',
        'novalidate',
        'open',
        'playsinline',
        'readonly',
        'required',
        'reversed',
        'selected',
        'truespeed'
    ]
    const jsReservedWords = [
        'break',
        'case',
        'catch',
        'class',
        'const',
        'continue',
        'debugger',
        'default',
        'delete',
        'do',
        'else',
        'export',
        'extends',
        //'false',It is an expression so ok for arguments check
        'finally',
        'for',
        'function',
        'if',
        'import',
        'in',
        'instanceof',
        'new',
        'null',
        'return',
        'super',
        'switch',
        'this',
        'throw',
    // 'true',It is an expression so ok for arguments check
        'try',
        'typeof',
        'var',
        'void',
        'while',
        'with'
    ]
    const isReservedWord = (word) => jsReservedWords.indexOf(word)>=0

    const buildClasses = (componentRoot, elem, elemString, compString, topForString, definition, initCode, controlCode, eventCode, styles, route, routeVars, forVars) => {
        if (elem.tagName == "TEMPLATE")
            return; //Ignore template tags

        // Fetch any data-attrs and order them in the processing order
        let keys = Object.keys(elem.dataset).sort();
        if (keys.indexOf('data-component')) {
            let hasBind = false;
            for (let key of keys) {
                if (key.startsWith('bind')) {
                    elem.setAttribute('data-on1-'+key.substring(4),elem.dataset[key]+"=e.detail.value");
                    hasBind = true;
                }
            }
            if (hasBind)
                keys = Object.keys(elem.dataset).sort();
        }

        if (keys.length>0) {

            if (componentRoot) {
                let keysToRemove = ['component']
                for (let key of keys) {
                    if (key.startsWith('arg') > 0 || key.startsWith('bind') > 0)
                        keysToRemove.push(key)
                }
                for (let key of keysToRemove) {
                    let componentIndex = keys.indexOf(key)
                    if (componentIndex >= 0)
                        keys.splice(componentIndex, 1)
                }
            }
            else {
                if (keys.indexOf('component')>=0) {                
                    let filteredKeys = ['component']
                    for (let key of keys) {
                        if (key.startsWith('arg') || key.startsWith('bind') || key.startsWith('action1') || key.startsWith('style1')
                            || key.startsWith('class1') || key.startsWith('if1') || key.startsWith('on1') || key.startsWith('attr1')
                            || key.startsWith('timer1') || key.startsWith('interval1') || key.startsWith('route1') 
                            || key.startsWith('rest1') || key.startsWith('rest-options1') || key.startsWith('calc1'))
                            filteredKeys.push(key)
                    }
                    keys = filteredKeys;
                }
            } 

            let orderedKeys = []
            let firsts = ['style1', 'if1', 'action1', 'on1', 'attr1', 'class1', 'component', 'style', 'if', 'for', 'calc', 'attrName', 'attrMin', 'attrMax', 'attrValue', 'value']; // Need to be first in that order.
            for (let first of firsts) {
                let indexInKeys = keys.indexOf(first);
                if (indexInKeys >= 0) {
                    orderedKeys.push(first)
                    keys.splice(indexInKeys,1)
                }
            }
            for (let key of keys) {
                orderedKeys.push(key)
            }
            let indent = "    "
            for (let key of orderedKeys) {
                let value = elem.dataset[key];
                let transformerFunctionReference = ""


                if (elem.id != '' && elemString != "this.root" && elemString === compString)
                    elemString = "document.getElementById('"+elem.id+"')"

                switch (key) {
                    case "text":
                        controlCode.push(indent+"_v = `" + value + "`;\n    if (" + elemString + ".textContent !== _v)\n      " + elemString + ".textContent = _v"); // Update DOM element with HTML Element from template string if different
                        break;
                    case "html":
                        controlCode.push("_v=`" + value + "`;if (" + elemString + ".innerHTML !== _v) " + elemString + ".innerHTML = _v"); // Update DOM element with HTML Element from template string if different
                        break;
                    case "value":
                        if (elem.type == 'checkbox') {
                            if (elem.hasAttribute('name') || elem.hasAttribute('data-attr-name'))
                                controlCode.push(indent + elemString + ".checked = " + value + ".indexOf(" + elemString + ".value) > -1");
                            else
                                controlCode.push(indent + elemString + ".checked = " + value);
                        }
                        else if (elem.type == 'radio') {
                            if (elem.hasAttribute('name') || elem.hasAttribute('data-attr-name'))
                                controlCode.push(indent + elemString + ".checked = " + value + " == " + elemString + ".value");
                            else
                                controlCode.push(indent + elemString + ".checked = " + value);
                        }
                        else if (elem.type == 'file') {
                            let transformerIndex = value.indexOf(':')
                            if (transformerIndex >= 0) {
                                transformerFunctionReference = value.substring(transformerIndex+1)
                                value = value.substring(0, transformerIndex)
                            }
                        }
                        else
                            controlCode.push(indent + elemString + ".value = " + value);
                        let eventType = "change";
                        if (elem.tagName === 'TEXTAREA' || elem.type === 'range') {
                            eventType = 'input';
                        }

                        const eventName = 'value' // Create pseudo eventName for data-value handlers, so a real change or input event can still be registered on the element
                        let eventId = eventName+"_"+uniqueID();
                        initCode.push(compString + ".dataset.event_" + eventName + " = '" + eventId+"'");

                        const eventContext = getEventContext(elem)
                        let valueValue = value;
                        
                        if (eventContext.forContext) {
                            const {forIterator, contextVar, idxName} = eventContext.forContext;
                            if (valueValue == contextVar+'.item') { // in case of value array update the reference to it.
                                valueValue = forIterator + '[' + idxName + ']'
                            }
                        }
                        eventCode.push({
                            'elemId':(topForString === undefined ? compString : topForString),
                            'eventType':eventType,
                            'handlerEventCheck': "  if (!isEventHandler(e.target, '"+eventName + "', '" + eventId + "')) return;",
                            'handlerName': eventId,
                            'handlerCode': (elem.type === 'file') ?
                                (valueValue + "=e.target.files[0];importData(e.target, ()=>{_mainInstance.controller({})}, "+transformerFunctionReference+")") :
                                (valueValue + "=typedReturn(e.target," + valueValue + ");"),
                            'forContext': "let ctxIdx = indexesInForAncestors(e.target);" + eventContext.contextString + ";",
                            "deferredUpdate": elem.type === 'file'
                        })
                        break;
                    case "style1": {
                        if (componentRoot)
                            break;
                    }    
                    case "style":
                        controlCode.push("_v=`" + value + "`;if (" + elemString + ".getAttribute('style') !== _v) " + elemString + ".setAttribute('style',  _v)"); // Update DOM element with HTML Element from template string if different
                        break;

                    case "class1": {
                        if (componentRoot)
                            break;
                    }    
                    case "class":
                        const classPairs = value.split(';')
                        for (const classPair of classPairs) {
                            let _class, _expr;
                            if (classPair.indexOf(':') >= 0) {
                                _class = classPair.substring(0, classPair.indexOf(':'));
                                _expr = classPair.substring(classPair.indexOf(':') + 1);
                            }
                            else {
                                _class = _expr = classPair; //Shorthand for set class based on the name of the boolean var.
                            }
                            controlCode.push(elemString + ".classList.toggle('" + _class + "', " + _expr + ")");
                        }
                        break;

                    case "route1": {
                        if (componentRoot)
                            break;
                    }    
                    case "route":
                        {
                            let [_expr, _class] = parseIfExpression(value);
                            value =  _expr

                            if (value.startsWith('/')) {
                                route = []
                                value = value.substring(1);
                            }

                            let subroute = value.split('/');
                            if (subroute.length===0)
                                subroute.push('')

                            route = route.concat(subroute)
                            value = "reken.routing_path.length>="+route.length+""
                            for (let i = 0; i < route.length; i++) {
                                if (route[i].startsWith('#')) {
                                    let routeAssignment = `let ${route[i].substring(1)} = reken.routing_path[${i}]`
                                    if (controlCode.indexOf(routeAssignment) < 0) {
                                        routeVars.push(routeAssignment)
                                    }
                                }
                                else
                                    value += `&&reken.routing_path[${i}] === '${route[i]}'`
                            }
                            if (_class)
                                value = _class + ':' + value
                        }
                        // Notice we drop into the if case to process the routing expression

                        case "if1": {
                            if (componentRoot)
                                break;
                        }
                        case "if":
                        {
                            let [_expr, _class] = parseIfExpression(value);
                            if (_class)
                                controlCode.push(elemString + ".classList.toggle('" + _class + "', " + _expr + ")");
                            else {
                                controlCode.push("_v=(" + value + "?'':'none');");
                                controlCode.push("if ("+elemString + ".style.display!==_v) " + elemString + ".style.display=_v;");
                            }

                            if (!elem.dataset.for) { // Elements with For process their own children
                                if (elem.dataset.if !== undefined || elem.dataset.if1 !== undefined || elem.dataset.route !== undefined)
                                    controlCode.push('if ('+parseIfExpression(value)[0] +') {') // Only execute controller code for children of elements with a data-if expression that is true, ie the element is shown.
                            }                    
                        }
                        break;
                    case "action1": {
                        if (componentRoot)
                            break;
                    }
                    case "action": {
                        let eventName = "click";
                        let eventId = eventName+"_"+uniqueID();
                        initCode.push(compString + ".dataset.event_" + eventName + " = (" + compString + ".dataset.event_" + eventName + "??'')+'" + eventId+"'+':'");

                        eventCode.push({
                            'elemId':(topForString === undefined ? compString : topForString),
                            'eventType':eventName,
                            'handlerEventCheck': "  if (!isEventHandler(e.target, '"+eventName + "', '" + eventId + "')) return;",
                            'handlerName': eventId,
                            'handlerCode':value,
                            'forContext': "let ctxIdx = indexesInForAncestors(e.target);" + getEventContext(elem).contextString + ";"
                        })
                    }
                    break;
                    
                    case "timer1": {
                        if (componentRoot)
                            break;
                    }
                    case "timer": {
                        const valueArray = value.split(':');
                        let [delay, condition] = valueArray;
                        let code = undefined;
                        if (valueArray.length>2)
                            code = valueArray.slice(2).join(':');

                        if (typeof delay === 'undefined' || typeof condition === 'undefined' || typeof code === 'undefined')
                            console.error(`data-timer: [${value}] incorrect amount of arguments`)
                        else {
                            let eventName = "timer";
                            let eventId = eventName+"_"+uniqueID();
                            initCode.push(compString + ".dataset.event_" + eventName + " = '" + eventId+"'");
            
                            eventCode.push({
                                'elemId':(topForString === undefined ? compString : topForString),
                                'eventType':eventName,
                                'handlerEventCheck': "",
                                'handlerName': eventId,
                                'handlerCode':code,
                                'forContext': "let ctxIdx = indexesInForAncestors(e.target);" + getEventContext(elem).contextString + ";"
                            })
                            controlCode.push(`{const _l = ${elemString}`);
                            controlCode.push(`if ((${condition}) && !_l.hasOwnProperty('timerID')) _l.timerID = setTimeout(()=>{this.${eventId}({'target':_l});delete _l.timerID;_mainInstance.controller({})}, ${delay})`);
                            controlCode.push(`if (!(${condition}) && _l.hasOwnProperty('timerID')) {clearTimeout(_l.timerID); delete _l.timerID}}`);
                        }
                    }
                    break;

                    case "interval1": {
                        if (componentRoot)
                            break;
                    }
                    case "interval": {
                        const valueArray = value.split(':');
                        let [interval, condition] = valueArray;
                        let code = undefined;
                        if (valueArray.length>2)
                            code = valueArray.slice(2).join(':');

                        if (typeof interval === 'undefined' || typeof condition === 'undefined' || typeof code === 'undefined')
                            console.error('data-interval: ['+value+'] incorrect amount of arguments')
                        else {
                            let eventName = "interval";
                            let eventId = eventName+"_"+uniqueID();
                            initCode.push(compString + ".dataset.event_" + eventName + " = '" + eventId+"'");
            
                            eventCode.push({
                                'elemId':(topForString === undefined ? compString : topForString),
                                'eventType':eventName,
                                'handlerEventCheck': "",
                                'handlerName': eventId,
                                'handlerCode':code,
                                'forContext': "let ctxIdx = indexesInForAncestors(e.target);" + getEventContext(elem).contextString + ";"
                            })
                            controlCode.push(`{const _l = ${elemString}`);
                            controlCode.push(`if ((${condition}) && !_l.hasOwnProperty('intervalID')) _l.intervalID = setInterval(()=>{this.${eventId}({'target':_l});_mainInstance.controller({})}, ${interval})`);
                            controlCode.push(`if (!(${condition}) && _l.hasOwnProperty('intervalID')) {clearInterval(_l.intervalID); delete _l.intervalID}}`);
                        }
                        break;
                    }

                    case "for":
                        if (topForString === undefined)
                            topForString = elemString

                        initCode.push(compString + ".dataset.leafCount=" + elem.children.length);

                        if ((elem.dataset.if !== undefined || elem.dataset.if1 !== undefined) && elem.children.length>0) {
                            controlCode.push(indent+'if ('+ parseIfExpression(elem.dataset.if)[0] +') {') // Only execute controller code for children of elements with a data-if expression that is true, ie the element is shown.
                            indent = '  ' + indent
                        }
            
                        let _var = value.substring(0, value.indexOf(':'));
                        let _data = value.substring(value.indexOf(':') + 1);
                        let _arrayName = '_arr_' + uniqueID();
                        if (isNaN(_data)) {
                            controlCode.push(indent+'let ' +_arrayName + ' = (typeof ('+_data+') !== "number"?'+_data+': new Array(parseInt(' + _data + ')))');
                        }
                        else
                            controlCode.push(indent+'let '+ _arrayName + ' = new Array(parseInt(' + _data + '))');
                        controlCode.push(indent+'updateForChildren(' + elemString + ',' + _arrayName + ', ' + elem.children.length + ')');

                        // At runtime loop thru the direct children
                        let _forVar = "rkn_forElem_" + uniqueID();
                        let _forIndex = "rkn_counter_" + uniqueID();
                        controlCode.push(indent+"for (let " + _forIndex + "=0;"+_forIndex+"<" + elemString + ".children.length/"+elem.children.length+";"+_forIndex+"++){");

                        controlCode.push(indent+"if (" + _forIndex + ">=" + _arrayName + ".length) break;"); //Basically if 0 elements in array
                        controlCode.push(indent+"let " + _var + "= {index:" + _forIndex + ", item:" + _arrayName + "[" + _forIndex + "]}"); // Set the var context
                        forVars += (forVars!=''?',':'') + _var
                        controlCode.push(indent+"let "+ _forVar)
                        let i = 0;
                        for (let child of elem.children) { // Only execute controller code for children of elements with a data-if expression that is true, ie the element is shown.
                            controlCode.push(indent+ _forVar + " = " + elemString+".children["+_forIndex+"*"+elem.children.length+"+"+i+"]")
                            buildClasses(false, elem.children[i], _forVar, compString+ ".children[" + i + "]", topForString, definition, initCode, controlCode, eventCode, styles, route, routeVars, forVars)
                            i++;
                        }
                        controlCode.push(indent+'}' + '// End loop ' + _forIndex);

                        if ((elem.dataset.if !== undefined || elem.dataset.if1 !== undefined) && elem.children.length>0) {
                            indent = indent.substring(2);
                            controlCode.push(indent+'}') //Close if statement
                        }
                        break;

                    case "calc1": {
                        if (componentRoot)
                            break;
                    }
                    case "calc":
                        if (elem.tagName === 'SCRIPT')
                            controlCode.unshift(elem.textContent.trim());
                        else
                            controlCode.push("elem = "+ elemString + ";" + value + ";"); // Update DOM element with HTML Element from template string if different
                        break;

                    case "component":
                        let oldTopForString = topForString
                        topForString = undefined; //Reset the outermost for-loop.
                        let className = value;
                        if (!generatedClass[value] || !generatedClass[value+'_static'] || elem.dataset.hasSlot=='true' || forVars != '') {
                            let compInitCode = [];
                            let compControlCode = [];
                            let compEventCode = [];
                            
                            buildClasses(true, elem, "this.root", "this.root", topForString, definition, compInitCode, compControlCode, compEventCode, styles, route, routeVars, forVars)

                            if (elem.dataset.for === undefined) { // Process the children unless the component definition also has a for loop, then the children will be processed there.
                                let i = 0;
                                for (let child of elem.children) { // Only execute controller code for children of elements with a data-if expression that is true, ie the element is shown.
                                    let elemString = "this.root"
                                    buildClasses(false, child, elemString + ".children[" + i + "]", elemString + ".children[" + i + "]", topForString, definition, compInitCode, compControlCode, compEventCode, styles, route, routeVars, forVars)
                                    i++
                                }
                                if (elem.dataset.if !== undefined) {
                                    compControlCode.push('}') //Close if statement
                                }
                            }
                            if (!generatedClass[value]) { //Create base class
                                const [compDefinition, compStyle] = generateComponentClass(value, value, compInitCode, compControlCode, compEventCode, routeVars, "")
                                styles.push(...compStyle);
                                definition.push(...compDefinition)
                                definition.push(`classRegistry['${className}']=${className.replace('-','_')}`)
                                generatedClass[className] = true;        
                            }
                            if (elem.dataset.hasSlot=='true' || forVars != '') {
                                className = value+'_'+uniqueID();
                                const [compDefinition, compStyle] = generateComponentClass(className, value, compInitCode, compControlCode, compEventCode, routeVars, forVars)
                                definition.push(...compDefinition)
                                definition.push(`classRegistry['${className}']=${className.replace('-','_')}`)
                                generatedClass[className] = true;
                            }
                            else {
                                if (value !== '_main') {
                                    className = value+'_static';
                                    if (!generatedClass[className]) {
                                        const [compDefinition, compStyle] = generateComponentClass(className, value, compInitCode, compControlCode, compEventCode, routeVars, forVars)
                                        definition.push(...compDefinition)
                                        definition.push(`classRegistry['${className}']=${className.replace('-','_')}`)
                                        generatedClass[className] = true;
                                    }
                                }

                            }
                        }
                        else {
                            className = value+'_static'
                        }
                        elem.dataset.className = className;

                        //Add code for class initialization, root component instances in setup, childcomponent instances in class definition
                        initCode.push(`    ${compString}.rkn_class = new ${className.replace('-','_')}(${compString})`)

                        controlCode.push("    {"); 
                        let args = []
                        for (let attr of Object.keys(elem.dataset)) {
                            if (attr.startsWith("arg") || attr.startsWith('bind')) {
                                let arg = attr.substring(3).toLowerCase()
                                if (attr.startsWith('bind'))
                                    arg = attr.substring(4).toLowerCase()
                                let value = elem.dataset[attr]                 
                                //Check if variable
                                let argValue = uniqueID();
                                if (/^[a-zA-Z_$][0-9a-zA-Z_$.\[\]\']*$/.test(value)) {
                                    if (isReservedWord(value))
                                        controlCode.push("      let " + argValue + " = '"+value+"'")
                                    else if (value.indexOf('\'')>0)
                                        controlCode.push("      let " + argValue + " = "+value+"") //If it contains a single quote, assume it will be a object qualifier
                                    else
                                        controlCode.push("      let " + argValue + " = ((typeof " + value + "!== 'undefined' && " + value + " !== window['" + value + "'])||typeof "+value+"=='function'?"+value+":'"+value+"')")
                                }
                                    //Check if number
                                else if (!isNaN(value)) {
                                    controlCode.push("      let " + argValue + ' = ' +value)
                                }
                                //Otherwise template string
                                else
                                    controlCode.push("      let " + argValue + " = `"+value+"`")

                                args.push(`${arg}:${argValue}`)
                                
                            }
                        }
                        let _stringArgs = args.join(',');
                        if (args.length > 0)
                            _stringArgs += ','
                        _stringArgs += forVars
                        controlCode.push(`      ${elemString}.rkn_class.controller({${_stringArgs}})`)
                        controlCode.push('    }')
                        break;

                    case "rest1": {
                            if (componentRoot)
                                break;
                        }
                    case "rest":
                        let _array = value.substring(0, value.indexOf(':'));
                        let _url = value.substring(value.indexOf(':') + 1);
                        let path = '';
                        let nextTokenIndex = _url.indexOf(':')
                        if (nextTokenIndex > 0 && !_url.startsWith('http')) {
                            path = '.' + _url.substring(0, nextTokenIndex);
                            _url = _url.substring(nextTokenIndex + 1);
                        }
                        // get rest options if available
                        let options = '{}'
                        if (elem.dataset.restOptions) {
                            options = elem.dataset.restOptions
                        }
                        if (elem.dataset.restOptions1) {
                            options = elem.dataset.restOptions1
                        }
                        controlCode.push("    processRestCall(" + elemString + ",`" + _url + "`, "+options+", (js)=>{"+ " if (this instanceof _main) " + _array + "=js" + path + "; else this." + _array + "=js" + path +";_mainInstance.controller({})})");
                        break;

                    default: {
                        if (key.startsWith('attr') || (key.startsWith('attr1') && !componentRoot)) {
                            let _attr = capCharToHyphen(key.substring(key.startsWith('attr1')?5:4));
                            if (booleanAttrs.includes(_attr.toLowerCase()))
                                controlCode.push("if ("+value+"){" + elemString + ".setAttribute('" + _attr + "', `" + value + "`)}else{"+elemString + ".removeAttribute('" + _attr + "')}")
                            else
                            controlCode.push("if (" + elemString + ".getAttribute('" + _attr + "') !== `" + value + "`) " + elemString + ".setAttribute('" + _attr + "', `" + value + "`)");
                        }
                        else if (key.startsWith('on') || (key.startsWith('on1') && !componentRoot)) {
                            let eventName = key.substring(key.startsWith('on1')?3:2).toLowerCase();
                            let handler = value;
                            let eventId = eventName+"_"+uniqueID();
                            initCode.push(compString + ".dataset.event_" + eventName + " = '" + eventId+"'");
            
                            eventCode.push({
                                'elemId':(topForString === undefined ? compString : topForString),
                                'eventType':eventName,
                                'handlerEventCheck': "  if (!isEventHandler(e.target, '"+eventName + "', '" + eventId + "')) return;",
                                'handlerName': eventId,
                                'handlerCode':handler,
                                'forContext': "let ctxIdx = indexesInForAncestors(e.target);" + getEventContext(elem).contextString + ";"
                            })
                        }
                    }
                }
            }
        }
        if (!elem.dataset.component && !elem.dataset.for) { // Elements with Component and For process their own children
            let i = 0;
            for (let child of elem.children) { 
                buildClasses(false, child, elemString + ".children[" + i + "]", compString + ".children[" + i + "]", topForString, definition, initCode, controlCode, eventCode, styles, route, routeVars, forVars)
                i++
            }
            if (elem.dataset.if !== undefined || elem.dataset.route !== undefined)
                controlCode.push('} else {disableTimers('+elemString+')}')
        }
        else {
            if (elem.dataset.if1 != undefined && !componentRoot) {
                controlCode.push('} else {disableTimers('+elemString+')}')
            }
        }        
    }
    // Used to convert dateset attribute names back to html attribute name
    const capCharToHyphen = (string) => {
        let newString = ''
        for (const l of string) {
            
            if (l.match(/[a-z]/i) && l === l.toUpperCase() && newString.length>0) {
                newString += '-'
            }
            newString += l.toLowerCase();
        }
        return newString;
    }

    const processComponentReferences = (elem) => {
        //Process component references
        if (elem.tagName != 'TEMPLATE' && 'component' in elem.dataset) {
            let component = getComponent(elem.dataset.component)
            if (component != null) { //Should be there unless component definition does not exist.
                for (let child of elem.children) {
                    processComponentReferences(child)
                }

                let _slotElement = component.querySelector('slot')
                if (_slotElement !=null && elem.childNodes.length > 0) { // Process slot
                    component.dataset.hasSlot='true'

                    let _beforeElement = _slotElement;
                    for (let i = elem.childNodes.length-1; i >= 0; i--) {
                        let child = elem.childNodes[i];
                        _slotElement.parentElement.insertBefore(child, _beforeElement)
                        _beforeElement = child;
                    }
                        _slotElement.parentElement.removeChild(_slotElement)
                }
                let instanceAttributes = ['data-action', 'data-style', 'data-class', 'data-if', 'data-timer', 'data-interval',
                                            'data-route', 'data-rest', 'data-rest-options', 'data-calc']
                for (let attr of elem.getAttributeNames()) { //Copy the attributes
                    if (instanceAttributes.indexOf(attr)>=0) {
                        component.setAttribute(attr+'1', elem.getAttribute(attr))
                        continue;
                    }
                    if (attr.startsWith('data-on')) {
                        component.setAttribute('data-on1'+attr.substring(7), elem.getAttribute(attr))
                        continue;
                    }
                    if (attr.startsWith('data-attr')) {
                        component.setAttribute('data-attr1'+attr.substring(9), elem.getAttribute(attr))
                        continue;
                    }
                    if (component.getAttribute(attr)==null) {
                        if (elem.getAttribute(attr)!=null) {
                            component.setAttribute(attr, elem.getAttribute(attr))
                        }
                    }
                    else {
                        if (attr.startsWith('data-arg') || attr.startsWith('data-bind'))
                            component.setAttribute(attr, elem.getAttribute(attr))
                        if (attr == 'class')
                            component.classList.add(elem.getAttribute('class'))                        
                    }
                }
                elem.parentElement.replaceChild(component, elem)
            }
        }
        else {
            for (let child of elem.children) {
                processComponentReferences(child)
            }
        }
    }
    const getComponent = (componentName) => {
        let component = componentRegistry[componentName];
        if (component === undefined) {
            let template = document.querySelector(`template[data-component='${componentName}']`)
            if (template == null || template.content == null || template.content.children.length == 0) {
                console.error(`Component ${componentName}: no component definition found`)
                return null;
            }
            for (let elem of template.content.children) {
                if (elem.tagName !== 'STYLE' && elem.tagName !== 'SCRIPT') {
                    component = elem;
                    break;
                }
            }
            processComponentReferences(component) // Process component children
            component.setAttribute('data-component', componentName)
            componentRegistry[componentName] = component;
        }
        let componentClone = component.cloneNode(true);
        return componentClone;
    }

    const generateComponentClass = (componentName, templateName, compInitCode, compControlCode, compEventCode, routeVars, forVars) => {
        let templateElement = document.querySelector("template[data-component='"+templateName+"']")

        const isBaseClass = (componentName == templateName || componentName == '_main')
        let output = []

        // State initialization
        const [stateVars, initCode] = getStateVars(templateElement)
        stateVars.push("root")

        // Get comp arguments
        const initArgs = getInitParams(templateElement, 'arg')
        const initBinds = getInitParams(templateElement, 'bind')
        // Create a list of bind names from the bind default assignment declarations
        const bindKeys = initBinds.map(paramAssign => paramAssign.substring(0,paramAssign.indexOf('=')))
        const initParams = [...initArgs, ...initBinds]
        // Create a list of parameter names from the parameter default assignment declarations
        const paramKeys = initParams.map(paramAssign => paramAssign.substring(0,paramAssign.indexOf('=')))
        // Add method calls
        const [methods, methodCode] = getMethods(templateElement, stateVars, initParams)


        // Build constructor
        output.push('//==============================================================================')
        output.push(`class ${componentName.replace('-', '_')} extends ${isBaseClass?'rkn_base':templateName.replace('-','_')} {`);
        //    output.push(`class ${componentName.replace('-', '_')} extends rkn_base {`);

        if (isBaseClass && componentName != '_main') {
            output.push(...methodCode)
            output.push('  constructor(root) {');
            output.push('  super(root)');
        
            output.push('    this.root = root;');

        
            output.push(...initCode)
            for (let _var of stateVars)
            output.push(`    this.${_var} = ${_var}`)

            output.push('  }')

            output.push('  }');
            return [output, getStyle(templateElement)]
        }
            
        output.push('  constructor(root) {');
        output.push('  super(root)');

        output.push('    this.root = root;');
        // Add references to top descendant classes
        output.push(...compInitCode)

        //Add event registrations
        for (let event of compEventCode)
            output.push('    '+event.elemId + ".addEventListener('" + event.eventType + "', event => this."+event.handlerName+"(event))");
        output.push('  }')

        // Create static factory method
        output.push('  static createInstance(elem) {')
        output.push(`    return new ${componentName.replace('-', '_')}(elem);`)
        output.push('  }')
        
        let stringParams = initParams.join(',')
        if (initParams.length > 0)
            stringParams+=','
        stringParams += forVars

        // Build controller
        output.push(`  controller({${stringParams}}) {`)

        // if (componentName === '_main')
        //     output.push('console.time("controller")');

        for (let _var of stateVars)
            output.push(`    let ${_var} = this.${_var}`)
        
        for (let _method of methods)
            output.push(_method)

        if (componentName === '_main') {
            for (let _routeVar of routeVars) {
                output.push("    "+_routeVar)
            }
        }

        //inject script code
        output.push(...getScript(templateElement))

        if (compControlCode.length>0) {
            output.push('    let _v, elem')
            output.push(...compControlCode)

        }

        // save potentially updated argument state
        for (let paramAssign of initParams) {
            let param = paramAssign.substring(0,paramAssign.indexOf('='))
            output.push("    this." + param +" = " + param) 
        }

        // save potentially updated member state
        for (let _var of stateVars)
            output.push(`    this.${_var} = ${_var}`)

        // if (componentName === '_main')
        // output.push('console.timeEnd("controller")');
        output.push('  }')

        // Build event handlers
        for (let event of compEventCode) {
            output.push("  "+ event.handlerName+"(e) {")
            output.push("  " + event.handlerEventCheck);

            // set state vars
            for (let _var of stateVars)
                output.push(`    let ${_var} = this.${_var}`)

            for (let param of paramKeys)
                output.push("    let " + param +" = this." + param) 

            for (let _routeVar of routeVars) {
                output.push("    "+_routeVar)
            }
            
            for (let _method of methods)
                output.push(_method)


            //Add for loop context(s)
            output.push("    " + event.forContext);
            //Add event handler code
            output.push("    " + event.handlerCode)   

            //Notify if value argument has changed
            for (let valueVar of bindKeys) {
                output.push("    if ("+valueVar+"!==this."+valueVar+") root.dispatchEvent(new CustomEvent('"+valueVar+"', {detail:{'value':"+valueVar+"},bubbles: true}))");
            }

            for (let _var of stateVars)
                output.push(`    this.${_var} = ${_var}`)
            
            if (!(event.deferredUpdate || event.eventType === 'timer'|| event.eventType === 'interval')) 
                output.push("    _mainInstance.controller({})");
            output.push("  }");
        }

        //end class
        output.push('}')
        return [output, getStyle(templateElement)]
    }
    // Load first template script and isolate the state variables.
    const getStateVars = (templateElement) => {
        let stateVars = []
        let initCode = []
        if (templateElement) {
            let scriptElement = templateElement.content.querySelector('script')
            if (scriptElement != null && !scriptElement.hasAttribute('data-calc') && scriptElement.childNodes.length>0) {
                let _code =  scriptElement.textContent.split(/\r?\n/); // Create array of state init code.
                for (let line of _code) {
                    line = line.trim()
                    if (line.startsWith('function'))
                        break;
                    if (line == '' || !line.startsWith('let'))
                        continue;
                    initCode.push('    '+line); // Add state init code to class constructor
                    let assignment = line.split(/=? /) // If assigment add it is a class member and initialize
                    let _var = assignment[1];
                    stateVars.push(_var)
                }
            }
        }
        return [stateVars, initCode]
    }
    // Load first template script and isolate the function methods
    const getMethods = (templateElement, stateVars, initArgs) => {
        let methods = []
        methods.push('    let dispatch = (type, content)=>this.dispatch(type, content)')

        let initCode = []
        let beforeFunctions = true;
        if (templateElement) {
            let scriptElement = templateElement.content.querySelector('script')
            if (scriptElement != null && !scriptElement.hasAttribute('data-calc') && scriptElement.childNodes.length>0) {
                let _code =  scriptElement.textContent.split(/\r?\n/); // Create array of state init code.
                
                for (let line of _code) {
                    line = line.trim()
                    if (line.startsWith('function')) {
                        beforeFunctions = false
                        line = line.substring(8)
                        let _funcName = line.substring(0,line.indexOf('(')).trim()
                        let _params = line.substring(_funcName.length+1, line.indexOf(')')+1).trim()

                        initCode.push('  '+line.trim()); // Add state init code to class constructor
                        for (let _var of stateVars)
                            initCode.push(`    let ${_var} = this.${_var}`)

                        for (let _method of methods)
                            initCode.push('  '+_method)


                        for (let argAssign of initArgs) { // Comp arguments
                            let arg = argAssign.substring(0,argAssign.indexOf('='))
                            initCode.push("  let " + arg +" = this." + arg) 
                        }
                        methods.push(`let ${_funcName} = ${_params}=>this.${_funcName}${_params}`)
                        continue;
                    }
                    if (beforeFunctions)
                        continue;
                    initCode.push('    '+line); // Add state init code to class constructor
                }
            }
        }
        return [methods, initCode]
    }

    // Find the component arguments
    const getInitParams = (templateElement, paramType, withValue=true, separator='=') => {
        let args = []
        if (templateElement) {
            for (let attr of Object.keys(templateElement.dataset)) {
                if (attr.startsWith(paramType)) {
                    let arg = attr.substring(paramType.length).toLowerCase()
                    if (withValue) {
                        let value = templateElement.dataset[attr]
                        if (value != "")
                            arg += `${separator}${isNaN(value)?"'"+value+"'":value}`
                        else
                            arg += `${separator}undefined` // Default is empty string
                    }
                    args.push(arg)
                }
            }
        }
        return args
    }
    // Find the first style tag for a component and prepend with the component selector
    const getStyle = (templateElement) => {
        if (templateElement && templateElement.content.querySelector('style')) {
            let rekenStyle = templateElement.content.querySelector('style')
            if (rekenStyle != null && rekenStyle.textContent) {
                let componentName = templateElement.dataset.component;
                let _styleLines =  rekenStyle.textContent.split(/\r?\n/); // Create array of styles
                for (let i = 0; i < _styleLines.length; i++) {
                    if (_styleLines[i].indexOf('{')>0) {
                        let selectors = _styleLines[i].split(',');
                        let selectorArray = []
                        for (let selector of selectors) {
                            let _hostPosition = selector.indexOf(':host')
                            if (_hostPosition >= 0)
                                selector = selector.substring(_hostPosition+5)
                            let _selector = selector.trim();
                            if ('.#[:'.indexOf(_selector[0])<0) _selector = ' '+_selector;
                            selector = `[data-component=${componentName}]` + _selector;
                            selectorArray.push(selector);
                        }
                        _styleLines[i]=selectorArray.join(',')
                    }
                }
                return _styleLines;
            }
        }
        return [];
    }
    // Find the first script tag for a component and return javascript
    const getScript = (templateElement) => {
        if (templateElement && templateElement.content.querySelector('script[data-calc]')) {
            let rekenScript = templateElement.content.querySelector('script[data-calc]')
            if (rekenScript != null && rekenScript.textContent) {
                let _scriptLines =  rekenScript.textContent.split(/\r?\n/); // Create of script lines
                return _scriptLines
            }
        }
        return [];
    }

    // Generates the code that sets up the context before the event code gets executed.
    const getEventContext = (elem, eventContext) => {
        if (typeof eventContext === 'undefined') {
            eventContext = {};
            eventContext.idx = 0;
            eventContext.contextString = '';
        }
        let _parent = elem.parentElement;
        if (_parent != null) {        
            getEventContext(_parent, eventContext); 

            if (typeof _parent.dataset.for !== 'undefined') {
                eventContext.forContext = getForContext(_parent);
                const idxName = 'ctxIdx[' + (eventContext.idx++) + ']'

                eventContext.forContext.idxName = idxName;
                const {forIterator, contextVar} = eventContext.forContext;

                let _forContextString =  "let " + contextVar + "= {index:" + idxName + "};"
                _forContextString += "if (typeof ("+ forIterator +") !== 'number' && typeof ("+ forIterator +") !== 'undefined')"+ contextVar+"['item'] = "+ forIterator  + "[" + idxName + "];"
                eventContext.contextString = eventContext.contextString + _forContextString;

                return eventContext;
            }
        }
        return eventContext;
    }

    // Generate the code that sets up the context for when processing elements in a for loop.
    const getForContext = (forElem) => {
        let value = forElem.dataset.for;
        let _contextVar = value.substring(0, value.indexOf(':'));
        let _forIterator = value.substring(value.indexOf(':') + 1);

        let _returnObject = {
            "forIterator": _forIterator,
            "contextVar": _contextVar,
        }
        return _returnObject;
    }

    // Fetch if expression and optional class which gets set when expression is true
    const parseIfExpression = (value) => {
        let _class = null;
        let _expr = value;
        if (value.indexOf(':') >= 0) {
            _class = value.substring(0, value.indexOf(':'));
            _expr = value.substring(value.indexOf(':') + 1);
        }
        return [_expr, _class];
    }

    let _ID = 0;
    const uniqueID = () => {
        return 'rkn' + _ID++; // Change of collisions will super small
    }

    const substituteShortHandComponentNames = (root, template) => {
        const compName = template.dataset.component;
        root.querySelectorAll(compName).forEach((elem)=> {
            // Find the non style, script tag
            let tagName = 'DIV'
            for (const elem of template.content.children) {
                if (elem.tagName != 'SCRIPT' && elem.tagName !== 'STYLE') {
                    tagName = elem.tagName
                    break;
                }
            }
            const replaceElement = document.createElement(tagName)
            for (let index = elem.attributes.length - 1; index >= 0; --index) {
                let attr = elem.attributes[index];
                if (template.hasAttribute('data-arg-'+attr.name)) {
                    replaceElement.setAttribute('data-arg-'+attr.name, elem.getAttribute(attr.name))
                    continue;
                }
                else if (template.hasAttribute('data-bind-'+attr.name)) {
                    replaceElement.setAttribute('data-bind-'+attr.name, elem.getAttribute(attr.name))
                    continue;
                }
                else {
                    if (attr.name.startsWith('data-attr')) {
                        // If a short-hand attribute is set with data-attr-xxxx then just make it an attribute data-arg-xxxx
                        const name = attr.name.substring(10);
                        if (template.hasAttribute('data-arg-'+name)) { //only useful for arg not bind as bind needs a variable name.
                            replaceElement.setAttribute('data-arg-'+name, elem.getAttribute(attr.name))
                            continue;
                        }
                    }
                    replaceElement.attributes.setNamedItem(elem.attributes[index].cloneNode());
                }
            }
            // Copy reken element content
            let beforeChild;
            for (let i = elem.childNodes.length-1; i >= 0; i--) {
                let child = elem.childNodes[i]; 
                if (replaceElement.childNodes.length == 0)
                    replaceElement.appendChild(child)
                else
                    replaceElement.insertBefore(child, beforeChild)
                beforeChild = child;
            }
            replaceElement.setAttribute('data-component', compName);
            elem.parentElement.replaceChild(replaceElement, elem);
        })
        return compName
    }

    const processShortHandComponentNames = () => {
        let componentNames = []
        document.querySelectorAll('template[data-component]').forEach((template)=> {
            // Update main DOM
            componentNames.push(substituteShortHandComponentNames(document, template))
            // Update templates
            document.querySelectorAll('template[data-component]').forEach((templateDoc)=>{
                substituteShortHandComponentNames(templateDoc.content, template)
            })
        })
        updateStyleSheetShortHandNames(componentNames);
        componentNames.sort((a,b)=>b.length-a.length)
    }

    const updateStyleSheetShortHandNames = (componentNames) => {
        document.querySelectorAll('head > style').forEach( style => {
            const lines = style.textContent.split('\n')
            const newLines = []
            for (let line of lines) {
                if (line.indexOf('{') >= 0) {
                    for (const name of componentNames) {
                        let nameIndex = 0;

                        while (nameIndex >= 0) {
                            nameIndex = line.indexOf(name, nameIndex)

                            if (nameIndex >= 0) {
                                if ((nameIndex == 0 || '\t ,>+~]'.indexOf(line[nameIndex-1])>=0) && '\t ,.:{>+~['.indexOf(line[nameIndex+name.length])>=0) {
                                    line = line.substring(0,nameIndex) + '[data-component='+name+']' + line.substring(nameIndex+name.length)
                                    nameIndex += ('[data-component='+name+']').length
                                }
                                else {
                                    nameIndex++;
                                }
                            }
                        }
                    }
                }
                newLines.push(line)
            }
            style.textContent = newLines.join('\n');
        })
    }
    /* Runtime Helpers *********************************************************************************************************/
    const processIncludes = (element, path) => {
        const promiseArray = []
        element.querySelectorAll('div[data-include]').forEach(async (includeElem)=> {
            let includeName = includeElem.dataset['include']
            if (includeName) {
                if (path && !includeName.startsWith('/')) {
                    includeName = path + '/' + includeName
                }
                const fetchPromise = fetch(includeName)
                .then(response => {
                    if (response.ok) {
                        return response.text()
                    }
                    else {
                        throw Error(`${response.status} - ${response.statusText}`);
                    }
                })
                .then((html) => {
                    includeElem.innerHTML = html;
                    const pathArray = includeName.split('/');
                    if (pathArray.length>1) {
                        pathArray.pop();
                        path = pathArray.join('/')
                    };
                    return processIncludes(includeElem, path)})
                .catch(() => {
                    includeElem.textContent = `File ${includeName} not found.`
                });
                promiseArray.push(fetchPromise);
            }
        })
        return Promise.allSettled(promiseArray)
    }

    const processRestCall = (elem, _url, _options, modelUpdate) => {
        // Url request is the same as last time, no need to fetch again and thus nothing do here.
        if (_options && typeof _options.fetch !== 'undefined') {
            if (_options.fetch === false)
                return;
            _options.fetch = false;
        }
        else {
            if (typeof elem.dataset.url !== undefined && elem.dataset.url === _url) {
                return;
            }
            elem.dataset.url = _url;
        }
        elem.classList.add("reken-rest-busy");
        elem.classList.remove("reken-rest-error", "reken-rest-done");
        let skip = false;
        fetch(_url, _options)
            .then(response => {
                if (!response.ok && !response.status === 304) {
                    throw new Error(`Network response was not ok, code ${response.status} - ${response.statusText}`);
                }
                if (response.status === 304) {
                    skip = true;
                    return
                }
                _options.response = response;
                if (_options.transformer) {
                    let promise = Promise.resolve(response.text())
                    return promise.then(text => _options.transformer(text, _options))
                }
                else {
                    return response.json();
                }       
            })
            .then(json => {
                if (!skip)
                    modelUpdate(json)
                elem.classList.add("reken-rest-done");
            })
            .catch(error => {
                elem.classList.add("reken-rest-error");
                throw error;
            })
            .finally(() => {
                elem.classList.remove("reken-rest-busy");
            })
    }

    const typedReturn = (elem, value) => {
        switch (elem.type) {
            case "checkbox":
                if (elem.getAttribute('name')) {
                    if (elem.checked && value.indexOf(elem.value) < 0)
                        value.push(elem.value);
                    if (!elem.checked && value.indexOf(elem.value) > -1)
                        value.splice(value.indexOf(elem.value), 1);
                    return value;
                }
                else
                    return elem.checked;
            case "radio":
                if (elem.getAttribute('name'))
                    return elem.value;
                else
                    return elem.checked;
            case "number":
            case "range":
                return elem.valueAsNumber;
            case "file":
                return elem.files[0]
            default:
            return elem.value;
        }
    }
    const importData = (elem, updateModel, fileTransformer) => {
        let file_to_read = elem.files[0];
        let fileread = new FileReader();
        fileread.onload = function(e) {
            let content = e.target.result;
            if (!fileTransformer)
                elem.files[0].data = JSON.parse(content); // parse json 
            else
                elem.files[0].data = fileTransformer(content, file_to_read); // parse json 
            updateModel()
        };
        fileread.readAsText(file_to_read);
    };

    const indexesInForAncestors = (elem, indexes) => {
        if (typeof indexes === 'undefined')
            indexes = [];
        let parent = elem.parentElement;
        if (parent != null) {
            indexesInForAncestors(parent, indexes);
            if (typeof parent.dataset.for != 'undefined')
                indexes.push(Math.floor(indexOf(parent.children, elem)/parent.dataset.leafCount));
        }
        return indexes;
    }

    const isEventHandler = (elem, eventType, eventId) => {
        const eventName = 'event_'+eventType;
        if (elem.dataset[eventName] && elem.dataset[eventName].indexOf(eventId)>=0) {
            return !(elem.hasAttribute('disabled') || elem.hasAttribute('readonly'));
        }
        if (elem.parentElement == null)
            return false;
        return isEventHandler(elem.parentElement, eventType, eventId)
    }

    const indexOf = (list, item) => {
        let i = 0;
        for (let value of list) {
            if (value === item)
                return i;
            i++;
        }
        return -1;
    }

    const updateForChildren = (elem, array, leafs) => {
        let _children = elem.children;
        let _numberOfChildren = _children.length/leafs;
        if (_numberOfChildren > 0) {
            
            let _firstChilds = [] 
            for (let l = 0; l < leafs; l++) {
                _firstChilds[l] = _children[l];
                _firstChilds[l].removeAttribute('id');
                _firstChilds[l].querySelectorAll('[id]').forEach(_childElem => {
                    _childElem.removeAttribute('id');
                })
            }

            for (let i = 0; i < array.length; i++) {
                let _child;
                for (let l = 0; l < leafs; l++) {
                    let elemIndex = i*leafs+l;
                    if (i < _numberOfChildren) { // There is an element for this array instance
                        _child = _children[elemIndex];
                    }
                    else { // No child yet create it
                        _child = _firstChilds[l].cloneNode(true);
                        initComponentElement(_child)

                        elem.appendChild(_child);
                    }
                    if (_child.style.display !== '')
                        _child.style.display = '';
                }
            }
            let checkForTimers=true;
            for (let i = array.length; i < _numberOfChildren; i++) {
                for (let l = 0; l < leafs; l++) {
                    let elemIndex = i*leafs+l;

                    if (_children[elemIndex].style.display !== 'none') {                
                        _children[elemIndex].style.display = 'none';
                        if (checkForTimers) {
                            if (disableTimers(_children[elemIndex])==0)
                                checkForTimers = false;
                        }
                    }
                    else
                        continue;
                }
            }
        }
    }
    const disableTimers = (elem) => {
        let count = 0
        if (elem.hasOwnProperty('intervalID')) {
            clearInterval(elem.intervalID);
            delete elem.intervalID;
            count++;
        }
        if (elem.hasOwnProperty('timerID')) {
            clearInterval(elem.timerID);
            delete elem.timerID;
            count++
        }
        let _children = elem.children;
        for (let i = 0; i < _children.length; i++) {
            count+=disableTimers(_children[i])
        }
        return count;
    }

    const initComponentElement = (elem) => {
        if (elem.dataset.component !== undefined) {
            if (elem.rkn_class === undefined) {
                elem.rkn_class = classRegistry[elem.dataset.className].createInstance(elem)
            }
            return;
        }
        for (let child of elem.children) {
            initComponentElement(child)
        }
    }

    const _rekenInit = () => {
        function getParsedHash(hash) {
            let routing_path = []
            if (hash.length>2) {
                const path = hash.substring(2)
                routing_path = path.split("/");
            }
            routing_path.push('')
            return routing_path;
        }
        reken.routing_path = getParsedHash(window.location.hash);

        window.addEventListener('hashchange', (e) => {
            reken.routing_path = getParsedHash(window.location.hash);
            document.body.parentElement.rkn_class.controller({})
        })

        if (!isServerGenerated()) {
            let definition = [];
            let controller = [];
            //let setup = ['_r = document.body.parentElement'];
            let setup = [];
            let styles = ['template {display:none !important;}'];

            document.body.parentElement.setAttribute('data-component', '_main')
            definition.push('class rkn_base { dispatch(type, content){this.root.dispatchEvent(new CustomEvent(type, {detail:content}))}} ')
            buildClasses(false, document.body.parentElement, "_r", "_r", undefined, definition, setup, controller, [], styles, [], [], '')
            if (styles.length>0) {
                const headElem = document.querySelector('head');
                if (headElem == null) {
                    headElem = document.createElement('head');
                    document.body.parentElement.insertBefore(headElem, document.body)
                }
                const styleElem = document.createElement('style');
                styleElem.textContent = styles.join('\n')
                headElem.appendChild(styleElem);
            }

            definition.push("let _mainInstance = _main.createInstance(document.body.parentElement)")
            definition.push("document.body.parentElement.rkn_class = _mainInstance");
            definition.push("document.body.dispatchEvent(new CustomEvent('rekeninitialized', {}))")
            definition.push("_mainInstance.controller({})")
            definition.push("document.body.dispatchEvent(new CustomEvent('rekenready', {}))")

            let definitionString = definition.join('\n')
            // console.log(definitionString)
            let controllerFunction = new Function('reken', 'classRegistry', 'updateForChildren', 'disableTimers', 'processRestCall', 'indexesInForAncestors', 'isEventHandler', 'typedReturn', 'importData', definitionString);
            if (!doGenerateCode())
                controllerFunction(reken, classRegistry, updateForChildren, disableTimers, processRestCall, indexesInForAncestors, isEventHandler, typedReturn, importData);
            if (doGenerateCode() && !isServerGenerated()) {
                var element = document.createElement('a');
                let html = document.body.parentElement.innerHTML.split('\n');
                let newHTML = []
                for (let line of html) {
                    if (line.indexOf('reken.js')>=0) {
                        line = ''
                    }
                    newHTML.push(line)
                }
                html = newHTML;
                element.setAttribute('href', 'data:text/plain;charset=utf-8,' +
                    encodeURIComponent(
                        '<html>' +
                        html.join('\n') +
                        '<script>var rkn_server_generated = true</script>'+
                        '<script src="../src/reken.js"></script>'+                  
                        '<style>\n' +
                        styles.join('\n') +
                        '</style>\n' +
                        '<script>\n' +
                        definitionString +
                        '</script>\n'+
                        '</html>'
                    ));
                    console.log(styles.join('\n'))
                    console.log(definitionString)
                
                element.setAttribute('download', document.title + '.txt');
                element.textContent = "Download Reken page controller";
                document.body.appendChild(element);
            }
        }
    }
    /* Force executing the controller, only call as last resort for example after async model updates */
    reken.forceCalculate = () => {
        document.body.parentElement.rkn_class.controller({})
    }
    // Export the reken global object
    globalThis.reken = reken;

    if (!isServerGenerated()) {
        processIncludes(document.body.parentElement)
        .then((result) => {
            if (!isServerGenerated()) {
                processShortHandComponentNames();
                processComponentReferences(document.body.parentElement);
            }
            _rekenInit();
        });
    }
}