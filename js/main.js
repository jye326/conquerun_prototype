// --- DOM 요소 가져오기 ---
const mapContainer = document.getElementById('map');
const runButton = document.getElementById('runButton');
const messageModal = document.getElementById('messageModal');
const messageText = document.getElementById('messageText');
const closeModalButton = document.getElementById('closeModalButton');
const locationText = document.getElementById('location-text');
const rankingList = document.getElementById('ranking-list'); // 랭킹 리스트 DOM 요소 가져오기

// --- 상태 및 목업 데이터 변수 ---
let isRunning = false;
let map = null;
let path = [];
let polyline = null;
let territory = null;
let watchId = null; // setInterval ID를 저장할 변수
let currentLocationMarker = null; // 현재 위치를 표시할 마커
let rivalNumberMarker = null; // 경쟁 영토 내 숫자 마커
let userCapturedNumberMarker = null; // 사용자가 점령한 영역 내 숫자 마커

// 테스트를 위한 목업 위치 (선릉역)
const mockInitialPosition = { lat: 37.5045, lon: 127.0489 };
let currentMockPosition = { ...mockInitialPosition };

// 경쟁 영토 관련 변수
// 선릉역 주변의 경쟁 영토 좌표 (사각형)
const rivalTerritoryBaseCoords = [
    [37.5035, 127.0479], // South-West
    [37.5035, 127.0499], // South-East
    [37.5055, 127.0499], // North-East
    [37.5055, 127.0479]  // North-West
];
let rivalTerritoryLayer = null; // Leaflet 레이어
let rivalGeoJson = null; // Turf.js 연산을 위한 GeoJSON

// --- 초기화 함수 ---
function initMap() {
    // Leaflet 지도를 생성하고 목업 위치를 중심으로 설정합니다.
    map = L.map(mapContainer).setView([mockInitialPosition.lat, mockInitialPosition.lon], 16);

    // OpenStreetMap 타일 레이어를 추가합니다.
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    // 현재 위치에 마커를 표시합니다.
    currentLocationMarker = L.marker([mockInitialPosition.lat, mockInitialPosition.lon]).addTo(map)
        .bindPopup('현재 위치: 선릉역');

    // UI에 현재 위치 텍스트를 설정합니다.
    locationText.textContent = `현재 위치: 선릉역`;

    // Turf.js 연산을 위해 경쟁 영토를 GeoJSON 형태로 변환합니다.
    // Leaflet LatLng 배열을 Turf.js [longitude, latitude] 배열로 변환합니다.
    const turfRivalBaseCoords = [rivalTerritoryBaseCoords.map(coord => [coord[1], coord[0]])];
    // 폴리곤을 닫습니다 (첫 번째와 마지막 좌표가 같도록).
    if (turfRivalBaseCoords[0][0][0] !== turfRivalBaseCoords[0][turfRivalBaseCoords[0].length - 1][0] ||
        turfRivalBaseCoords[0][0][1] !== turfRivalBaseCoords[0][turfRivalBaseCoords[0].length - 1][1]) {
        turfRivalBaseCoords[0].push(turfRivalBaseCoords[0][0]);
    }
    let baseRivalPolygon = turf.polygon(turfRivalBaseCoords);

    // 경쟁 영토를 반시계 방향으로 15도 회전합니다.
    const pivot = turf.point([mockInitialPosition.lon, mockInitialPosition.lat]);
    rivalGeoJson = turf.transformRotate(baseRivalPolygon, -15, { pivot: pivot });

    // 회전된 경쟁 영토 (보라색 사각형)를 지도에 추가합니다.
    rivalTerritoryLayer = L.geoJSON(rivalGeoJson, {
        style: {
            color: 'purple',
            fillColor: '#800080',
            fillOpacity: 0.4
        }
    }).addTo(map);

    // 경쟁 영토 중앙에 초기 숫자 10 표시
    addRivalNumberMarker(rivalGeoJson, 1500);
    // 초기 랭킹 데이터를 업데이트합니다.
    updateRankingDisplay();
}

/**
 * 경쟁 영토 중앙에 숫자를 표시하는 함수
 * @param {object} polygonGeoJson - Turf.js 폴리곤 GeoJSON 객체
 * @param {number} number - 표시할 숫자
 */
function addRivalNumberMarker(polygonGeoJson, number) {
    if (rivalNumberMarker && map.hasLayer(rivalNumberMarker)) {
        map.removeLayer(rivalNumberMarker);
    }
    if (!polygonGeoJson) return;
    const centroid = turf.centroid(polygonGeoJson);
    const lat = centroid.geometry.coordinates[1];
    const lon = centroid.geometry.coordinates[0];
    const customIcon = L.divIcon({
        className: 'number-marker rival-number-marker',
        html: String(number),
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
    rivalNumberMarker = L.marker([lat, lon], { icon: customIcon }).addTo(map);
}

/**
 * 사용자가 점령한 영역 중앙에 숫자를 표시하는 함수
 * @param {object} polygonGeoJson - Turf.js 폴리곤 GeoJSON 객체
 * @param {number} number - 표시할 숫자
 */
function addUserTerritoryNumberMarker(polygonGeoJson, number) {
    if (userCapturedNumberMarker && map.hasLayer(userCapturedNumberMarker)) {
        map.removeLayer(userCapturedNumberMarker);
    }
    if (!polygonGeoJson) return;
    const centroid = turf.centroid(polygonGeoJson);
    const lat = centroid.geometry.coordinates[1];
    const lon = centroid.geometry.coordinates[0];
    const customIcon = L.divIcon({
        className: 'number-marker user-captured-number-marker',
        html: String(number),
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
    userCapturedNumberMarker = L.marker([lat, lon], { icon: customIcon }).addTo(map);
}

// --- 달리기 관련 함수 ---
function startRunning() {
    if (isRunning) return;

    isRunning = true;
    updateButtonUI();

    // 이전 영토와 폴리라인이 있다면 제거합니다.
    if (territory && map.hasLayer(territory)) map.removeLayer(territory);
    if (polyline && map.hasLayer(polyline)) map.removeLayer(polyline);

    // 달리기 시작 시, 이전에 생성된 경쟁 영토의 남은 부분 레이어를 모두 제거합니다.
    map.eachLayer(function(layer) {
        if (layer.options && layer.options.color === 'purple') {
            map.removeLayer(layer);
        }
        if (layer.options && layer.options.color === 'green' && layer !== territory) {
            map.removeLayer(layer);
        }
    });

    // 초기 경쟁 영토를 다시 생성하고 회전하여 지도에 추가합니다.
    const turfRivalBaseCoords = [rivalTerritoryBaseCoords.map(coord => [coord[1], coord[0]])];
    if (turfRivalBaseCoords[0][0][0] !== turfRivalBaseCoords[0][turfRivalBaseCoords[0].length - 1][0] ||
        turfRivalBaseCoords[0][0][1] !== turfRivalBaseCoords[0][turfRivalBaseCoords[0].length - 1][1]) {
        turfRivalBaseCoords[0].push(turfRivalBaseCoords[0][0]);
    }
    let baseRivalPolygon = turf.polygon(turfRivalBaseCoords);
    const pivot = turf.point([mockInitialPosition.lon, mockInitialPosition.lat]);
    rivalGeoJson = turf.transformRotate(baseRivalPolygon, -15, { pivot: pivot });

    rivalTerritoryLayer = L.geoJSON(rivalGeoJson, {
        style: {
            color: 'purple',
            fillColor: '#800080',
            fillOpacity: 0.4
        }
    }).addTo(map);

    addRivalNumberMarker(rivalGeoJson, 1500);

    path = [];
    currentMockPosition = { ...mockInitialPosition }; // 위치 초기화
    path.push(L.latLng(currentMockPosition.lat, currentMockPosition.lon)); // 시작점 추가
    polyline = L.polyline(path, { color: 'red' }).addTo(map);

    // 시계 방향 20도 회전을 위한 삼각 함수 값
    const angleRad = 20 * Math.PI / 180; // 20도 (시계 방향)
    const cosTheta = Math.cos(angleRad);
    const sinTheta = Math.sin(angleRad);

    // 위치 추적 시뮬레이션을 시작합니다. (0.2초마다 위치 업데이트)
    let step = 0;
    watchId = setInterval(() => {
        const move = 0.0001; // 기본 이동 거리
        let dx = 0;
        let dy = 0;

        // 선릉역 주변을 사각형으로 도는 시뮬레이션 경로에 회전 적용
        if (step >= 0 && step < 15) { // 원래 동쪽 이동
            dx = move;
            dy = 0;
        } else if (step >= 15 && step < 30) { // 원래 남쪽 이동
            dx = 0;
            dy = -move;
        } else if (step >= 30 && step < 45) { // 원래 서쪽 이동
            dx = -move;
            dy = 0;
        } else if (step >= 45 && step < 60) { // 원래 북쪽 이동
            dx = 0;
            dy = move;
        } else {
            // 한 바퀴 돌면 시뮬레이션 종료
            stopRunning();
            return;
        }

        // 회전 변환 적용
        const rotatedDx = dx * cosTheta - dy * sinTheta;
        const rotatedDy = dx * sinTheta + dy * cosTheta;

        currentMockPosition.lon += rotatedDx;
        currentMockPosition.lat += rotatedDy;

        step++;

        // onPositionUpdate 함수에 목업 위치 전달
        onPositionUpdate({
            coords: {
                latitude: currentMockPosition.lat,
                longitude: currentMockPosition.lon
            }
        });
    }, 200); // 0.2초 간격으로 좀 더 부드럽게
}

function stopRunning() {
    if (!isRunning) return;

    // 위치 추적 시뮬레이션을 중지합니다.
    if (watchId) clearInterval(watchId);

    isRunning = false;
    watchId = null;
    updateButtonUI();

    // 영토를 만들기 위한 최소 경로 길이 확인
    if (path.length < 3) {
        showMessage("영토를 만들기에는 달린 거리가 너무 짧습니다.");
        if (polyline && map.hasLayer(polyline)) map.removeLayer(polyline);
        // rivalTerritoryLayer가 제거되었다면 다시 추가합니다.
        if (rivalTerritoryLayer && !map.hasLayer(rivalTerritoryLayer)) {
            map.addLayer(rivalTerritoryLayer);
        }
        return;
    }

    // 사용자 경로를 GeoJSON 폴리곤으로 변환합니다.
    const userPolygonCoords = [path.map(latLng => [latLng.lng, latLng.lat])];
    // 폴리곤을 닫습니다 (첫 번째와 마지막 좌표가 같도록).
    if (userPolygonCoords[0][0][0] !== userPolygonCoords[0][userPolygonCoords[0].length - 1][0] ||
        userPolygonCoords[0][0][1] !== userPolygonCoords[0][userPolygonCoords[0].length - 1][1]) {
        userPolygonCoords[0].push(userPolygonCoords[0][0]);
    }
    const userGeoJson = turf.polygon(userPolygonCoords);

    let intersection = null;
    let remainingRival = null;

    try {
        // 사용자 영토와 경쟁 영토의 교차 영역을 계산합니다.
        intersection = turf.intersect(rivalGeoJson, userGeoJson);
        // 경쟁 영토에서 사용자 영토와 겹치지 않는 부분을 계산합니다.
        remainingRival = turf.difference(rivalGeoJson, userGeoJson);
    } catch (e) {
        console.error("Turf.js 연산 중 오류 발생:", e);
        showMessage("영토 계산 중 오류가 발생했습니다. (자세한 내용은 콘솔 확인)");
        // 오류 발생 시 사용자 영토만 그리는 폴백
        territory = L.polygon(path, {
            color: 'green',
            fillColor: '#00FF00',
            fillOpacity: 0.4
        }).addTo(map);
        if (polyline && map.hasLayer(polyline)) map.removeLayer(polyline);
        map.fitBounds(territory.getBounds());
        return;
    }

    // 기존 경쟁 영토 레이어를 제거합니다.
    if (rivalTerritoryLayer && map.hasLayer(rivalTerritoryLayer)) {
        map.removeLayer(rivalTerritoryLayer);
    }

    // 남은 경쟁 영토를 지도에 추가합니다.
    if (remainingRival) {
        // turf.difference는 MultiPolygon을 반환할 수 있습니다.
        if (remainingRival.geometry.type === 'Polygon') {
            L.geoJSON(remainingRival, {
                style: {
                    color: 'purple',
                    fillColor: '#800080',
                    fillOpacity: 0.4
                }
            }).addTo(map);
        } else if (remainingRival.geometry.type === 'MultiPolygon') {
            remainingRival.geometry.coordinates.forEach(polyCoords => {
                L.polygon(polyCoords[0].map(coord => [coord[1], coord[0]]), { // LatLng로 변환
                    color: 'purple',
                    fillColor: '#800080',
                    fillOpacity: 0.4
                }).addTo(map);
            });
        }
    }

    // 교차 영역 (사용자가 점령한 부분)을 초록색으로 지도에 추가합니다.
    if (intersection) {
        if (intersection.geometry.type === 'Polygon') {
            L.geoJSON(intersection, {
                style: {
                    color: 'green',
                    fillColor: '#00FF00',
                    fillOpacity: 0.6 // 겹치는 부분은 더 불투명하게
                }
            }).addTo(map);
        } else if (intersection.geometry.type === 'MultiPolygon') {
            intersection.geometry.coordinates.forEach(polyCoords => {
                L.polygon(polyCoords[0].map(coord => [coord[1], coord[0]]), { // LatLng로 변환
                    color: 'green',
                    fillColor: '#00FF00',
                    fillOpacity: 0.6
                }).addTo(map);
            });
        }
    }

    // 사용자 전체 달리기 경로를 초록색 폴리곤(영토)으로 생성합니다.
    territory = L.polygon(path, {
        color: 'green',
        fillColor: '#00FF00',
        fillOpacity: 0.4
    }).addTo(map);

    // 사용자 전체 영토 중앙에 숫자 9 표시
    addUserTerritoryNumberMarker(userGeoJson, 9);

    // 달리기 경로 폴리라인을 제거합니다.
    if (polyline && map.hasLayer(polyline)) map.removeLayer(polyline);

    // 생성된 영토에 맞게 지도를 조정합니다.
    map.fitBounds(territory.getBounds());

    // 랭킹 데이터를 업데이트합니다. (예시: 임의의 값으로 업데이트)
    updateRankingDisplay();
}

// --- 위치 업데이트 콜백 함수 ---
function onPositionUpdate(position) {
    const lat = position.coords.latitude;
    const lon = position.coords.longitude;
    const newPos = L.latLng(lat, lon);

    path.push(newPos);
    polyline.addLatLng(newPos);

    map.panTo(newPos);
    currentLocationMarker.setLatLng(newPos); // 마커 위치 업데이트
    // UI에 현재 위치 텍스트를 업데이트합니다.
    locationText.textContent = `현재 위치: 달리는 중...`;
}

function onPositionError(error) { // 이 함수는 이제 목업 환경에서는 호출되지 않습니다.
    console.error(`위치 추적 오류: ${error.message}`);
    showMessage("위치를 추적하는 데 문제가 발생했습니다.");
    stopRunning();
}

// --- UI 업데이트 함수 ---
function updateButtonUI() {
    if (isRunning) {
        runButton.textContent = '달리기 종료';
        runButton.classList.remove('bg-green-500', 'hover:bg-green-600', 'focus:ring-green-300');
        runButton.classList.add('bg-red-500', 'hover:bg-red-600', 'focus:ring-red-300');
    } else {
        runButton.textContent = '달리기 시작';
        runButton.classList.remove('bg-red-500', 'hover:bg-red-600', 'focus:ring-red-300');
        runButton.classList.add('bg-green-500', 'hover:bg-green-600', 'focus:ring-green-300');
        // 달리기가 끝나면 위치 텍스트를 초기화하고 마커를 초기 위치로 되돌립니다.
        locationText.textContent = `현재 위치: 선릉역`;
        if (currentLocationMarker) {
            currentLocationMarker.setLatLng([mockInitialPosition.lat, mockInitialPosition.lon]);
        }
        addRivalNumberMarker(rivalGeoJson, 1250);
        if (userCapturedNumberMarker && map.hasLayer(userCapturedNumberMarker)) {
            map.removeLayer(userCapturedNumberMarker);
        }
    }
}

// 메시지 모달을 보여주는 함수
function showMessage(message) {
    messageText.textContent = message;
    messageModal.classList.remove('hidden');
}

// 랭킹 디스플레이 업데이트 함수 (예시 데이터 사용)
function updateRankingDisplay() {
    // 실제 애플리케이션에서는 서버에서 랭킹 데이터를 가져와야 합니다.
    // 여기서는 예시를 위해 더미 데이터를 사용합니다.
    const dummyRankings = [
        { name: "김민준", area: 1500 },
        { name: "이서연", area: 1320 },
        { name: "박지후", area: 1180 },
        { name: "최예나", area: 1050 },
        { name: "정우진", area: 990 }
    ];

    // 랭킹 데이터를 무작위로 섞어서 매번 다르게 보이게 함
    dummyRankings.sort();

    // 기존 랭킹 리스트 비우기
    rankingList.innerHTML = '';

    // 새로운 랭킹 항목 추가
    dummyRankings.forEach((player, index) => {
        const listItem = document.createElement('li');
        listItem.classList.add('ranking-item');
        listItem.innerHTML = `
            <span class="font-semibold">${index + 1}. ${player.name}</span> - ${player.area}m²
        `;
        rankingList.appendChild(listItem);
    });
}

// --- 이벤트 리스너 ---
runButton.addEventListener('click', () => {
    if (!map) {
        showMessage("지도가 로드되지 않았습니다. 잠시 후 다시 시도해주세요.");
        return;
    }
    isRunning ? stopRunning() : startRunning();
});

closeModalButton.addEventListener('click', () => {
    messageModal.classList.add('hidden');
});

// --- 앱 시작 ---
// DOM이 로드되면 지도를 초기화합니다.
document.addEventListener('DOMContentLoaded', initMap);
