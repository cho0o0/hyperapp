export function h(name, attributes) { // h と app のみexportしている。Vueと同じようにhはVirtual DOM作成時使用される
  var rest = [] // restには残ったh関数が入る
  var children = []
  var length = arguments.length

  while (length-- > 2) rest.push(arguments[length])

  while (rest.length) {
    var node = rest.pop()
    if (node && node.pop) { // nodeは配列なら
      for (length = node.length; length--; ) {
        rest.push(node[length])
      }
    } else if (node != null && node !== true && node !== false) {
      children.push(node)
    }
  }

  return typeof name === "function" // nodeを返す
    ? name(attributes || {}, children) // button({ onclick: actions.down }, "-")が書ける
    : {
        nodeName: name,
        attributes: attributes || {},
        children: children,
        key: attributes && attributes.key
      }
}

export function app(state, actions, view, container) {
  var map = [].map // childNodesの走査でcallを使用するためにわざわざmap functionを出している
  var rootElement = (container && container.children[0]) || null // containerの一番目の子要素を出している
  var oldNode = rootElement && recycleElement(rootElement) // HTML DOM -> Virtual DOM
  var lifecycle = [] // https://github.com/hyperapp/hyperapp#lifecycle-events
  var skipRender // フラグ変数（レンダリングを行うかどうか）
  var isRecycling = true // // 既存DOMを使用させる（主にSSRページ対応）ためのフラグになる(https://github.com/hyperapp/hyperapp#mounting)
  var globalState = clone(state) // immutableを実現する為に、objectのクローンが散見される
  var wiredActions = wireStateToActions([], globalState, clone(actions))

  scheduleRender()

  return wiredActions // appの戻り値はstateが挿入されたactions
  
  function recycleElement(element) { // DOM要素をVirtual DOMへ変換する
    return {
      nodeName: element.nodeName.toLowerCase(),
      attributes: {},
      children: map.call(element.childNodes, function(element) {
        return element.nodeType === 3 // Node.TEXT_NODE
          ? element.nodeValue
          : recycleElement(element) // 子要素も再帰で変換する
      })
    }
  }

  function resolveNode(node) { // JSXを得るための関数
    return typeof node === "function"
      ? resolveNode(node(globalState, wiredActions)) // view関数を実行し、Nodeをゲットする
      : node // Nodeならそのまま
  }

  function render() {
    var node = resolveNode(view) // viewはstateとactionsをとり、Node(JSXならbabelに変換してもらったNode)を返す関数

    if (container) {
      rootElement = patch(container, rootElement, oldNode, (oldNode = node)) // patch実行後、nodeをoldNodeに代入する
    }

    skipRender = isRecycling = false // HTML DOM生成できたら、これからのインタラクションは本ライブラリでハンドリングさせるために、skipRenderもisRecyclingもFalseにする

    while (lifecycle.length) lifecycle.pop()() // oncreateかonupdateはここで実行される
  }

  function scheduleRender() { // skipRenderはFalseならTrueに変換し、renderをスケジューリングする。TrueならRenderが行われない
    if (!skipRender && (skipRender = true)) setTimeout(render)
  }

  function clone(target, source) { // immutableを担保するutils関数
    var out = {}

    for (var i in target) out[i] = target[i]
    for (var i in source) out[i] = source[i]

    return out
  }

  function set(path, value, source) { // Nest Stateに対応するために使用されたヘルパー関数
    var target = {}
    if (path.length) {
      target[path[0]] =
        path.length > 1 ? set(path.slice(1), value, source[path[0]]) : value
      return clone(source, target)
    }
    return value
  }

  function get(path, source) { // Nest Stateに対応するために、pathを引数として取るstateを取得する関数になった
    var i = 0
    while (i < path.length) source = source[path[i++]]
    return source
  }

  function wireStateToActions(path, state, actions) { // 主流のフロントエンドフレームワークと同じく、CRUDではなく、EventベースのState変更になる
    for (var key in actions) {
      typeof actions[key] === "function"
        ? (function(key, action) { // 即時実行関数
            actions[key] = function(data) {
              var result = action(data) // 例：state => ({ count: state.count + data } になる（Closureの活用）

              if (typeof result === "function") {
                result = result(get(path, globalState), actions) // value => (state, actions) => { setTimeout(actions.up, 1000, value) } のようにstateだけでなく、actionsも引き数として取れる。(https://github.com/hyperapp/hyperapp#asynchronous-actions)
              }

              if ( // Asynchronous Actionsのための処理
                result &&
                result !== (state = get(path, globalState)) &&
                !result.then // !isPromise
              ) {
                scheduleRender(
                  (globalState = set(path, clone(state, result), globalState))
                )
              }

              return result
            }
          })(key, actions[key]) // 例：(up, value => state => ({ count: state.count + value }))
        : wireStateToActions( // ネストに対応するための分岐(https://github.com/hyperapp/hyperapp#nested-actions)
            path.concat(key),
            (state[key] = clone(state[key])),
            (actions[key] = clone(actions[key]))
          )
    }

    return actions
  }

  function getKey(node) { // Virtual DOMのNodeのキーを取得するヘルパー関数
    return node ? node.key : null
  }

  function eventListener(event) { // utils(イベント実行用)
    return event.currentTarget.events[event.type](event)
  }

  function updateAttribute(element, name, value, oldValue, isSvg) { // 例：(dom#div, onClick, el => {el.innerHTML = ""}, null, false)
    if (name === "key") {
    } else if (name === "style") { // styleの設定
      for (var i in clone(oldValue, value)) {
        var style = value == null || value[i] == null ? "" : value[i]
        if (i[0] === "-") { // -moz- に対応する為に
          element[name].setProperty(i, style)
        } else {
          element[name][i] = style
        }
      }
    } else {
      if (name[0] === "o" && name[1] === "n") { // eventListenerをバンドさせる(onClickだとclickイベントをバンドするとか)
        if (!element.events) {
          element.events = {}
        }
        element.events[(name = name.slice(2))] = value
        if (value) {
          if (!oldValue) { // すでにバンドされているケースの再度バンディングを防ぐ
            element.addEventListener(name, eventListener)
          }
        } else {
          element.removeEventListener(name, eventListener) // イベントを外す
        }
      } else if (name in element && name !== "list" && !isSvg) { // Attributeが要素にあれば 例："id" in document.querySelector("#Syntax") === true
        element[name] = value == null ? "" : value
      } else if (value != null && value !== false) { // 上記のケースじゃなければ直接に設定する処理
        element.setAttribute(name, value)
      }

      if (value == null || value === false) { // 外す処理
        element.removeAttribute(name)
      }
    }
  }

  function createElement(node, isSvg) { // Virtual DOMのnodeを使ってDOM要素（element）を作成する(Virtual DOM -> DOM)
    var element =
      typeof node === "string" || typeof node === "number"
        ? document.createTextNode(node) // stringか数字の場合はtextNode
        : (isSvg = isSvg || node.nodeName === "svg") //SVGのケースに対応する
          ? document.createElementNS(
              "http://www.w3.org/2000/svg",
              node.nodeName
            )
          : document.createElement(node.nodeName)

    var attributes = node.attributes
    if (attributes) {
      if (attributes.oncreate) { // oncreate例： {element => element.focus()}
        lifecycle.push(function() {
          attributes.oncreate(element) // https://github.com/hyperapp/hyperapp#oncreate
        })
      }

      for (var i = 0; i < node.children.length; i++) { // 子要素は再帰でDOMへAppendする
        element.appendChild(
          createElement(
            (node.children[i] = resolveNode(node.children[i])),
            isSvg
          )
        )
      }

      for (var name in attributes) { // ユーザが設定した全てのAttributeを処理する（https://github.com/hyperapp/hyperapp#supported-attributes）
        updateAttribute(element, name, attributes[name], null, isSvg) // Lifecycleイベントはここの対象に含まれていない
      }
    }

    return element
  }

  function updateElement(element, oldAttributes, attributes, isSvg) { // DOM要素の更新関数
    for (var name in clone(oldAttributes, attributes)) {
      if (
        attributes[name] !== // Attributeが変わったら更新させる
        (name === "value" || name === "checked"
          ? element[name]
          : oldAttributes[name])
      ) {
        updateAttribute(
          element,
          name,
          attributes[name],
          oldAttributes[name],
          isSvg
        )
      }
    }

    var cb = isRecycling ? attributes.oncreate : attributes.onupdate // oncreateかonupdateをlifecycle配列に入れてあとで実行させる
    if (cb) {
      lifecycle.push(function() {
        cb(element, oldAttributes)
      })
    }
  }

  function removeChildren(element, node) { // ondestoryがNodeにあれば実行させるために使用される関数
    var attributes = node.attributes
    if (attributes) {
      for (var i = 0; i < node.children.length; i++) {
        removeChildren(element.childNodes[i], node.children[i])
      }

      if (attributes.ondestroy) {
        attributes.ondestroy(element) // https://github.com/hyperapp/hyperapp#ondestroy
      }
    }
    return element
  }

  function removeElement(parent, element, node) { // HTML DOMの要素から該当要素を削除する関数
    function done() {
      parent.removeChild(removeChildren(element, node))
    }

    var cb = node.attributes && node.attributes.onremove // onremove例：(element, done) => fadeout(element).then(done)
    if (cb) {
      cb(element, done)  // Lifecycleのonremoveがあればコールバック(cb)として実行される(https://github.com/hyperapp/hyperapp#onremove)
    } else {
      done()
    }
  }

  function patch(parent, element, oldNode, node, isSvg) { // Nodeの差分を観察し、HTML DOM(element)を更新する・Lifecycleのイベントも実行させる関数。本ライブラリのミソ
    if (node === oldNode) {
    } else if (oldNode == null || oldNode.nodeName !== node.nodeName) {
      var newElement = createElement(node, isSvg)
      parent.insertBefore(newElement, element)

      if (oldNode != null) { // 旧Nodeを削除する処理
        removeElement(parent, element, oldNode)
      }

      element = newElement
    } else if (oldNode.nodeName == null) { // 配列対応？（要確認）
      element.nodeValue = node
    } else {
      updateElement(
        element,
        oldNode.attributes,
        node.attributes,
        (isSvg = isSvg || node.nodeName === "svg")
      )

      var oldKeyed = {} // NodeのキーがKeyになり、[element(HTML DOM), node(Virtual DOM)]のペアがValueになるMap形式オブジェクト
      var newKeyed = {}
      var oldElements = []
      var oldChildren = oldNode.children
      var children = node.children

      for (var i = 0; i < oldChildren.length; i++) { // oldKeyed(旧Elementー旧Node対応表の作成)
        oldElements[i] = element.childNodes[i]

        var oldKey = getKey(oldChildren[i])
        if (oldKey != null) {
          oldKeyed[oldKey] = [oldElements[i], oldChildren[i]]
        }
      }
      // ここから以下はキーを使って、新HTML DOM Elementを生成する処理
      var i = 0
      var k = 0

      while (k < children.length) {
        var oldKey = getKey(oldChildren[i])
        var newKey = getKey((children[k] = resolveNode(children[k])))

        if (newKeyed[oldKey]) {
          i++
          continue
        }

        if (newKey == null || isRecycling) {
          if (oldKey == null) {
            patch(element, oldElements[i], oldChildren[i], children[k], isSvg)
            k++
          }
          i++
        } else {
          var keyedNode = oldKeyed[newKey] || []

          if (oldKey === newKey) {
            patch(element, keyedNode[0], keyedNode[1], children[k], isSvg)
            i++
          } else if (keyedNode[0]) {
            patch(
              element,
              element.insertBefore(keyedNode[0], oldElements[i]),
              keyedNode[1],
              children[k],
              isSvg
            )
          } else {
            patch(element, oldElements[i], null, children[k], isSvg)
          }

          newKeyed[newKey] = children[k]
          k++
        }
      }

      while (i < oldChildren.length) {
        if (getKey(oldChildren[i]) == null) {
          removeElement(element, oldElements[i], oldChildren[i])
        }
        i++
      }

      for (var i in oldKeyed) {
        if (!newKeyed[i]) {
          removeElement(element, oldKeyed[i][0], oldKeyed[i][1])
        }
      }
    }
    return element // 新要素を返す
  }
}
