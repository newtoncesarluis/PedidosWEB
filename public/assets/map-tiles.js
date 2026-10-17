/**
 * Bases de mapa (Leaflet) sem chave de API, com visual parecido com o Google Maps.
 *  - Ruas      : Esri World Street Map (nomes de ruas, estilo Google)
 *  - Satélite  : Esri World Imagery
 *  - Mapa (OSM): OpenStreetMap padrão
 * A escolha do usuário fica salva no aparelho (localStorage).
 *
 * Uso:  const tiles = SysRepMapTiles.init(map);   // aplica a base salva
 *       tiles.cycle();                              // alterna Ruas → Satélite → OSM
 *       SysRepMapTiles.addControl(map, 'topright'); // (opcional) seletor nativo do Leaflet
 */
(function (global) {
  var KEY = 'sysrep_map_base';
  var ESRI = 'Tiles &copy; Esri';
  var ORDEM = ['Ruas', 'Satélite', 'Mapa (OSM)'];

  function criar() {
    return {
      'Ruas': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: ESRI + ' — Esri, HERE, Garmin, &copy; OpenStreetMap contributors', maxZoom: 19, maxNativeZoom: 19
      }),
      'Satélite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: ESRI + ' — Maxar, Earthstar Geographics', maxZoom: 19, maxNativeZoom: 18
      }),
      'Mapa (OSM)': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19,
        // o OSM bloqueia (403) pedidos sem Referer; garante o envio da origem mesmo com política restritiva
        referrerPolicy: 'strict-origin-when-cross-origin'
      })
    };
  }

  function lerSalva() {
    try { var n = localStorage.getItem(KEY); if (ORDEM.indexOf(n) >= 0) return n; } catch (_) {}
    return 'Ruas';
  }
  function gravar(nome) { try { localStorage.setItem(KEY, nome); } catch (_) {} }

  function init(map) {
    var layers = criar();
    var atual = lerSalva();
    layers[atual].addTo(map);
    var api = {
      map: map,
      layers: layers,
      nome: function () { return atual; },
      set: function (nome) {
        if (!layers[nome] || nome === atual) return atual;
        map.removeLayer(layers[atual]);
        layers[nome].addTo(map);
        layers[nome].bringToBack();
        atual = nome;
        gravar(nome);
        return atual;
      },
      cycle: function () {
        return api.set(ORDEM[(ORDEM.indexOf(atual) + 1) % ORDEM.length]);
      }
    };
    map.on('baselayerchange', function (e) { atual = e.name; gravar(e.name); });
    global.SysRepMapTiles._ultimo = api;
    return api;
  }

  function addControl(map, position) {
    var api = global.SysRepMapTiles._ultimo || init(map);
    L.control.layers(api.layers, null, { position: position || 'topright', collapsed: true }).addTo(map);
    return api;
  }

  global.SysRepMapTiles = { init: init, addControl: addControl, ORDEM: ORDEM };
})(window);
