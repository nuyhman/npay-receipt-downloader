// 현재 탭이 네이버페이 결제내역 페이지인지에 따라 단계가 정해진다.
const HISTORY_URL_PART = 'pay.naver.com/pc/history';

// 결합 이미지 버튼 라벨은 세 곳에서 쓰이므로 한 군데서 만든다.
function mergeButtonLabel(count) {
  return `이미지 병합 후 저장하기 (${count}개)`;
}

function setStep(step) {
  document.querySelector('main').dataset.step = String(step);
  document.getElementById('stepLabel').textContent =
    step === 1 ? '결제내역 열기' : '영수증 받기';
  document.getElementById('stepNum').textContent =
    step === 1 ? '01 / 02' : '02 / 02';
  document.getElementById('stepBar').style.width = step === 1 ? '50%' : '100%';
  document.querySelector('.steps').setAttribute('aria-valuenow', String(step));
}

function syncMonthLabels() {
  const month = document.getElementById('monthSelect').value;
  document.getElementById('openOrdersBtn').textContent = `${month}월 결제내역 열기`;
  document.getElementById('recapMonth').textContent = `${month}월`;
}

// 결제내역 페이지 URL에 남아 있는 startDate에서 월을 읽는다.
function monthFromUrl(url) {
  const match = /[?&]startDate=\d{4}-(\d{2})-/.exec(url || '');
  return match ? String(parseInt(match[1], 10)) : null;
}

document.addEventListener('DOMContentLoaded', async () => {
  // 영수증 캡처 버튼
  document.getElementById('captureBtn')?.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentUrl = tabs[0].url;
      if (currentUrl.includes('m.pay.naver.com/o/receipt/purchase/')) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'captureReceipt' });
      } else {
        alert('네이버페이 영수증 페이지에서만 사용할 수 있습니다.');
      }
    });
  });

  // 현재 월을 기본값으로 설정
  const currentMonth = new Date().getMonth() + 1; // getMonth()는 0-11 반환
  const monthSelect = document.getElementById('monthSelect');

  // 이미 존재하는 옵션 중에서 현재 월을 선택
  if (monthSelect) {
    monthSelect.value = currentMonth.toString();
  }

  // 현재 탭을 보고 단계를 정한다. 결제내역 페이지가 아니면 1단계만 보여주므로
  // '시작하기'가 아예 나오지 않고, 잘못 눌러 경고를 띄울 일도 없다.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onHistoryPage = !!(tab && tab.url && tab.url.includes(HISTORY_URL_PART));

  // 결제내역 페이지에 있다면 URL의 기간이 실제로 조회 중인 달이다.
  const urlMonth = monthFromUrl(tab && tab.url);
  if (urlMonth) {
    monthSelect.value = urlMonth;
  }

  syncMonthLabels();
  setStep(onHistoryPage ? 2 : 1);
  monthSelect.addEventListener('change', syncMonthLabels);

  document.getElementById('changeMonthBtn').addEventListener('click', () => {
    setStep(1);
  });

  // 총액은 background가 storage에도 저장한다. 서비스워커를 깨우는 것보다 빠르므로
  // storage로 먼저 확인해서, 보여줄 값이 있을 때만 자리를 잡고 로딩 표시를 띄운다.
  // (값이 없을 때 자리를 잡았다가 접으면 그게 다시 덜컹거림이 된다)
  const cached = await chrome.storage.local.get('totalPrice');
  if (cached && cached.totalPrice) {
    document.getElementById('totalPriceContainer').style.display = 'block';
    document.getElementById('totalPriceDisplay').style.display = 'none';
    document.getElementById('priceSkeleton').style.display = 'block';
  }

  // 저장된 총액과 캡처된 이미지를 한 번에 받아 레이아웃을 1회만 변경
  // (따로 처리하면 팝업 높이가 두 번 늘어나 덜컹거림)
  const [priceResponse, imageResponse] = await Promise.all([
    chrome.runtime.sendMessage({ action: 'getTotalPrice' }),
    chrome.runtime.sendMessage({ action: 'getCapturedImages' }),
  ]);
  console.log('백그라운드에서 받은 응답:', priceResponse, imageResponse);

  displayTotalPrice(priceResponse && priceResponse.totalPrice);

  if (imageResponse && imageResponse.count > 0) {
    const btn = document.getElementById('downloadCombined');
    btn.textContent = mergeButtonLabel(imageResponse.count);
    btn.style.display = 'block';
  }

  // 다운로드 모드 라디오 버튼 이벤트 리스너
  const individualRadio = document.getElementById('individualDownload');
  const combinedRadio = document.getElementById('combinedDownload');

  if (individualRadio && combinedRadio) {
    // 초기 상태 설정
    chrome.runtime.sendMessage({
      action: 'setCombinedDownloadMode',
      enabled: false,
    });

    // 라디오 버튼 변경 이벤트
    individualRadio.addEventListener('change', () => {
      if (individualRadio.checked) {
        chrome.runtime.sendMessage({
          action: 'setCombinedDownloadMode',
          enabled: false,
        });
      }
    });

    combinedRadio.addEventListener('change', () => {
      if (combinedRadio.checked) {
        chrome.runtime.sendMessage(
          {
            action: 'setCombinedDownloadMode',
            enabled: true,
          },
          (response) => {
            console.log('통합 다운로드 모드로 설정됨:', response);
          }
        );
      }
    });
  }

  // 통합 이미지 다운로드 버튼 이벤트 리스너
  document.getElementById('downloadCombined')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'getCapturedImages' }, (response) => {
      if (response && response.images.length > 0) {
        console.log(`${response.count}개 이미지 결합 시작`);
        combineImages(response.images);
      } else {
        alert('다운로드할 영수증 이미지가 없습니다.');
      }
    });
  });
});

// 주문 내역 페이지 버튼
document.getElementById('openOrdersBtn').addEventListener('click', () => {
  const keyword = '낙타,팀커피';
  function getMonthRange(month, year = new Date().getFullYear()) {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);

    const format = (date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
        2,
        '0'
      )}-${String(date.getDate()).padStart(2, '0')}`;

    return [format(firstDay), format(lastDay)];
  }

  // 선택된 월 가져오기
  const selectedMonth = parseInt(document.getElementById('monthSelect').value);
  const [startDate, endDate] = getMonthRange(selectedMonth);

  chrome.tabs.create({
    url: `https://new-m.pay.naver.com/pcpay?serviceCategory=LOCAL_PAY&statusGroup=PURCHASE_DECIDED&keyword=${encodeURIComponent(
      keyword
    )}&startDate=${startDate}&endDate=${endDate}`,
  });
});

document.getElementById('downloadStart').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // 단계를 정한 뒤 탭이 바뀌었을 수 있다. 경고창 대신 1단계로 되돌린다.
  if (!tab || !tab.url || !tab.url.includes(HISTORY_URL_PART)) {
    setStep(1);
    return;
  }

  // 저장된 이미지가 있는지 확인하고 초기화
  try {
    // Promise 기반으로 변환하여 처리
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getCapturedImages' }, resolve);
    });

    if (response && response.count > 0) {
      // 저장된 이미지가 있으면 초기화
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'clearCapturedImages' }, resolve);
      });
      console.log('기존에 저장된 이미지를 초기화했습니다.');
      // 다운로드 버튼 숨김
      document.getElementById('downloadCombined').style.display = 'none';
    }

    // 다운로드 모드 상태 확인 (통합 다운로드 모드인지)
    const combinedMode = document.getElementById('combinedDownload').checked;
    console.log(
      '현재 다운로드 모드:',
      combinedMode ? '통합 다운로드' : '개별 다운로드'
    );

    // 다운로드 모드 설정
    await chrome.runtime.sendMessage({
      action: 'setCombinedDownloadMode',
      enabled: combinedMode,
    });

    // 컨텐츠 스크립트 실행
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });

    // 명시적으로 팝업 창 닫기 (이 부분이 탭 닫힘 문제를 해결할 수 있음)
    window.close();
  } catch (error) {
    console.error('다운로드 시작 중 오류 발생:', error);
  }
});

// 이미지 결합 함수
function combineImages(images) {
  // 이미지 로드
  const loadImage = (src) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  };

  // 모든 이미지 로드
  Promise.all(images.map((img) => loadImage(img.imageData)))
    .then((loadedImages) => {
      // 캔버스 생성
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // 캔버스 크기 계산 (세로로 결합)
      let totalHeight = 0;
      let maxWidth = 0;

      loadedImages.forEach((img) => {
        totalHeight += img.height;
        maxWidth = Math.max(maxWidth, img.width);
      });

      // 캔버스 크기 설정
      canvas.width = maxWidth;
      canvas.height = totalHeight;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 이미지 그리기
      let y = 0;
      loadedImages.forEach((img) => {
        // 중앙 정렬
        const x = (maxWidth - img.width) / 2;
        ctx.drawImage(img, x, y);
        y += img.height;
      });

      // 결합된 이미지 데이터 생성
      const combinedImageData = canvas.toDataURL('image/png', 0.8);

      // 이미지 다운로드
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const link = document.createElement('a');
      link.href = combinedImageData;
      link.download = `네이버페이_영수증_통합_${timestamp}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // 다운로드 후 배열 초기화
      chrome.runtime.sendMessage(
        {
          action: 'clearCapturedImages',
        },
        () => {
          // 다운로드 버튼 숨김
          document.getElementById('downloadCombined').style.display = 'none';
        }
      );
    })
    .catch((error) => {
      console.error('이미지 결합 중 오류 발생:', error);
      alert('이미지 결합에 실패했습니다.');
    });
}

// 총액을 화면에 표시하는 함수
function displayTotalPrice(price) {
  const container = document.getElementById('totalPriceContainer');
  const display = document.getElementById('totalPriceDisplay');
  const skeleton = document.getElementById('priceSkeleton');

  if (skeleton) {
    skeleton.style.display = 'none';
  }

  // 금액 표시 컨테이너와 디스플레이 요소
  if (price && container && display) {
    // 금액을 표시 형식으로 변환 (쉼표 추가)
    const formattedPrice = parseInt(price).toLocaleString();
    display.textContent = formattedPrice + '원';
    display.style.display = 'block';
    container.style.display = 'block';
  } else if (container) {
    container.style.display = 'none';
  }
}

// background.js 또는 content.js에서 전송된 메시지 수신 처리
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('팝업에서 메시지 수신:', message);
  if (
    message.action === 'updateTotalPrice' ||
    message.action === 'totalPriceUpdated'
  ) {
    displayTotalPrice(message.totalPrice);
  } else if (message.action === 'allCapturesComplete') {
    // 모든 캡처 완료 메시지
    const btn = document.getElementById('downloadCombined');
    if (btn) {
      btn.textContent = mergeButtonLabel(message.count);
      btn.style.display = 'block';
    }
  } else if (message.action === 'autoCombineAndDownload') {
    // 자동 통합 다운로드 요청
    console.log(`자동 통합 다운로드 요청 수신: ${message.count}개 이미지`);
    if (message.images && message.images.length > 0) {
      combineImages(message.images);
    }
  }
});
