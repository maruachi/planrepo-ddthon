# Inception Plan: [시연] eSPEC 첨부파일 업로드 오류 조회·재처리

> 본 문서는 제공된 초안을 근거로 한 로컬 시연용 정리이며, 실제 eSPEC 담당자의 승인이나 운영 검증이 아닙니다. 사람이 답한 항목은 '확인됨'으로, AI가 보완한 항목은 '미확인'으로 표시합니다.

## 요구사항

### 목적 (확인됨 — 초안 근거)
- eSPEC 문서(PRC/INS) 첨부파일 중 `USE_YN = 'Y'` 이지만 `FILE_UPLOAD_DTTM`이 없는 비정상 건을 운영자가 직접 조회하고 재처리할 수 있도록 기능을 추가한다.
- 현재는 DB 조회 및 수동 확인이 필요하므로, Portal에서 대상 문서와 첨부파일 상태를 확인하고 재처리 결과까지 추적 가능하도록 개선한다.

### 오류 판정 규칙 (확인됨)
- 오류 판정: `ESPEC_ATTACH_FILE.USE_YN = 'Y' AND FILE_UPLOAD_DTTM IS NULL`.
- `USE_YN = 'N'` 파일과 정상(업로드 시각이 있는) 파일은 오류 판정에서 제외한다.
- 조회 단위: 오류 파일이 1건 이상인 문서(RPT_DOC_ID) 단위로 노출한다.
- 재처리 단위: 파일 1건 단위로 개별 실행한다(사람 답변으로 확정).

### 변경 범위 (확인됨)
- **Frontend**: `dks-espec-portal` / Vue.js
- **Backend**: `dks-espec-endpoint` / Spring Boot
- **DB**: Oracle (`RPT_DOC`, `ESPEC_ATTACH_FILE`)

### 제외 범위 (확인됨)
- 신규 테이블 생성, 파일 저장소 구조 변경, 기존 정상 첨부파일 이관, 인증/권한 체계 변경은 이번 범위에서 제외한다.

### 미확인 사항 (조사·검증 필요)
- 기존 업로드 Service의 재호출 가능 구조 여부 — 사람 답변: 미확인 — 조사 필요.
- 원본 파일 보관 위치·접근 권한, 트랜잭션 경계, 동시 재처리 제어 방식 — 미확인.
- 운영 권한 판정 코드·역할 — 미확인(기존 eSPEC 운영 권한 재사용 전제).
- 등록일 기준 컬럼, 조회 기간 필수 여부·기본값·최대 범위, 페이지 크기, 성능 수치 — 미확인.
- 재처리 결과 추적 방식과 이력 보존 기간 — 미확인.
- 응답 계약 불일치(예시 JSON의 `errorFileCount: 2`인데 `files` 배열이 1개) — 확인 과제.

### 원문 테스트 기준 (보존)
- 정상 파일만 존재하는 문서는 조회되지 않아야 함.
- 동일 `RPT_DOC_ID`에 정상/오류 파일이 섞여 있으면 문서는 조회되어야 함.
- `USE_YN = 'N'` 파일은 오류 판정에서 제외.
- 재처리 성공 시 `FILE_UPLOAD_DTTM`이 생성되어야 함.
- 이미 처리된 파일에 재요청 시 중복 업로드되지 않아야 함.
- PRC / INS 각각 조회 검증.
- 대량 조회 시 응답시간 및 Oracle 실행계획 확인.

## 사용자 시나리오

운영자는 `문서번호/기간 검색` → `업로드 오류 첨부파일 조회` → `대상 선택` → `재처리 요청` → `성공/실패 결과 표시` 흐름을 따른다.

아래 화면 구성은 초안 근거로 정리한 **제안**이며, 실제 eSPEC 화면이나 실행 결과가 아니다.

- **제안** 검색 화면: 검색영역에 문서번호 / 기간 / 문서구분(PRC/INS)을 입력한다.
- **제안** 오류 목록 화면: Grid에 문서번호, 오류 파일 수, 파일명, 상태, 재처리 버튼을 표시한다.
- **제안** 처리 중 화면: 재처리 전 Confirm을 표시하고 처리 중에는 버튼을 비활성화한다.
- **제안** 성공 안내 화면: 성공 시 해당 Row를 재조회하여 상태를 갱신한다.
- **제안** 실패 안내 화면: 실패 시 서버 오류 메시지를 표시한다.

### 상황 1 — 오류 조회와 성공 재처리
운영자가 조건으로 검색하면 오류 파일이 1건 이상인 문서가 목록에 노출되고, 파일 1건을 재처리하면 성공 시 `FILE_UPLOAD_DTTM`이 갱신되어 해당 Row가 재조회된다.

### 상황 2 — 이미 처리된 파일 Skip
재처리 직전 현재 상태를 재확인하여 이미 정상 처리된 건은 Skip 한다. 이미 처리된 파일에 재요청 시 중복 업로드되지 않아야 한다.

### 상황 3 — 원본 소실 실패
원본 파일이 이미 삭제되었거나 접근 불가한 경우 재처리는 불가능하며, 이번 범위에서는 실패 사유만 반환한다(사람 답변으로 확정). 별도 데이터 정리·알림은 이번 범위에서 제외한다.

### 상황 4 — 동시 요청·부분 실패
동일 파일에 대한 동시 재처리 요청은 처리 전 상태 재검증으로 중복 처리를 막는다. 파일 저장 후 DB 갱신 실패 등 부분 실패 시 파일 저장소와 DB 상태가 불일치할 수 있으며, DB rollback만으로 외부 파일 저장이 취소된다고 단정하지 않는다(검증 과제).

## 진행 계획

1. **구현 전 조사**: 기존 업로드 Service 재호출 가능 구조, 원본 파일 보관 위치·접근 권한, 트랜잭션 경계, 동시 재처리 제어, 운영 권한 코드, 등록일 기준 컬럼을 확인한다.
2. **응답 계약 확정**: 조회 API 응답 스키마와 `errorFileCount`·`files` 정합성을 확정한다.
3. **Backend 구현**: 조회 API와 파일 1건 단위 재처리 API를 구성한다.
4. **Frontend 구현**: 검색·목록·재처리 화면을 구성한다.
5. **회귀·성능 검증**: 기존 등록/업로드 회귀 테스트와 Oracle 실행계획·응답시간을 확인한다.

- 조회 기간 제한과 Pagination은 초안대로 포함한다. 기간 필수 여부·기본값·최대 범위·페이지 크기는 Oracle 실행계획·데이터 규모 확인 후 담당자가 결정할 항목으로 남긴다(미확인).

## 주요 구조

근거가 있는 관계만 아래에 정리한다. 모르는 관계는 미확인으로 남긴다.

- dks-espec-portal(Vue.js) → dks-espec-endpoint(Spring Boot): 오류 조회·재처리 API 호출
- dks-espec-endpoint → RPT_DOC: 대상 문서 조회
- dks-espec-endpoint → ESPEC_ATTACH_FILE: `MAPPING_1ST_KEY_ID = RPT_DOC_ID` 조인으로 활성 첨부파일 확인
- 재처리 API → 기존 파일 업로드 Service: 로직 재사용(재호출 가능 여부 미확인)
- 재처리 성공 → ESPEC_ATTACH_FILE.FILE_UPLOAD_DTTM: 업로드 시각 갱신

### API 개요 (초안 근거, 상세 설계 아님)
- GET `/api/attachments/upload-errors` — 입력 `rptDocId?`, `fromDate?`, `toDate?`, `docType?`(PRC/INS). 처리: RPT_DOC 조회 → ESPEC_ATTACH_FILE 조인 → `FILE_UPLOAD_DTTM IS NULL` 존재 확인 → 문서번호 기준 오류 파일 수/상세 반환.
- POST `/api/attachments/{fileId}/retry` — 기존 업로드 Service 재사용, 성공 시 `FILE_UPLOAD_DTTM` 갱신, 실패 시 원인 로그·오류 메시지 반환, 중복 요청 방지를 위해 현재 상태 재확인.

### 조회 쿼리 (초안 근거)
```sql
SELECT
    R.RPT_DOC_ID,
    COUNT(*) AS ERROR_FILE_COUNT
FROM RPT_DOC R
JOIN ESPEC_ATTACH_FILE A
  ON A.MAPPING_1ST_KEY_ID = R.RPT_DOC_ID
WHERE A.USE_YN = 'Y'
  AND A.FILE_UPLOAD_DTTM IS NULL
  AND (R.RPT_DOC_ID LIKE 'PRC%' OR R.RPT_DOC_ID LIKE 'INS%')
GROUP BY R.RPT_DOC_ID;
```
- 신규 테이블 생성 없음. 기존 인덱스 `ESPEC_ATTACH_FILE(MAPPING_1ST_KEY_ID)` 확인. 성능 문제 시 `USE_YN`, `FILE_UPLOAD_DTTM` 조건 포함 인덱스 검토(미확인).

## 주요 결정

- **재처리 단위 = 파일 1건 개별 재처리** (확인됨, 사람 답변). 문서 단위 일괄 재처리는 이번 범위 아님.
- **원본 부재 시 = 실패 사유만 반환** (확인됨, 사람 답변). 데이터 정리·알림 제외.
- **운영 권한 = 기존 eSPEC 운영 권한 재사용** (확인됨). 실제 역할·권한 코드는 미확인(구현 전 담당자 확인). 새 인증·권한 체계 제외.
- **조회 기간 제한·Pagination = 초안대로 포함** (확인됨). 필수 여부·기본값·최대 범위·페이지 크기는 미확인(담당자 결정).
- **재호출 가능 구조 = 미확인 — 조사 필요** (사람 답변). 재호출 불가 시 재처리 방식 재설계 필요.
- **부분 실패 보정 방식 = 미확인**. DB rollback만으로 외부 파일 저장이 취소된다고 단정하지 않음(검증 과제).
- **응답 계약 정합성 = 확인 과제**. 예시 JSON의 `errorFileCount: 2`와 `files` 1개 불일치를 API 계약 확정 시 정리.

### 위험 / 영향 / 대응 (원문 보존, 머리글 정리)

| 위험 | 영향 | 대응 |
| --- | --- | --- |
| 동일 파일 재처리로 인한 중복 업로드 | 파일 중복 저장 또는 상태 불일치 | 재처리 직전 `FILE_UPLOAD_DTTM` 재확인, 이미 정상 처리된 건은 Skip |
| 재처리 중 일부 단계만 성공하는 부분 실패 | 파일 저장소와 DB 상태 불일치 | 기존 업로드 Service의 트랜잭션 경계 확인, 실패 시 DB 상태를 정상적으로 Rollback/보정(단정 금지, 검증 필요) |
| 오류 건 대량 조회 시 Oracle 부하 증가 | 운영 DB 응답 지연 | 조회 기간 제한, Pagination 적용, 실행계획 및 인덱스 확인 |
| 원본 파일이 이미 삭제되었거나 접근 불가 | 재처리 자체가 불가능 | 재처리 전 원본 존재 여부 확인 후 사용자에게 명확한 실패 사유 반환 |
| 운영자 외 사용자의 재처리 API 호출 | 비정상 데이터 변경 가능 | 기존 eSPEC 권한 체계를 사용하여 운영 권한 사용자만 재처리 허용 |
| 기존 업로드 로직 변경에 따른 Regression | 정상 PRC/INS 첨부파일 처리 영향 | 신규 로직보다 기존 Service 재사용 우선, 기존 등록/업로드 회귀 테스트 수행 |
| 동일 파일에 대한 동시 재처리 요청 | Race condition, 중복 처리 | 처리 전 상태 재검증 및 필요 시 DB Lock/처리 상태값 적용 검토 |

## 작업 단위

### T1. 구현 전 조사 (선행)
- 기존 업로드 Service 재호출 가능 구조, 원본 파일 보관 위치·접근 권한, 트랜잭션 경계, 동시 재처리 제어 방식, 운영 권한 코드, 등록일 기준 컬럼을 확인한다.
- 담당: SR 담당자.
- 완료 기준: 각 미확인 항목에 대해 확인 결과(가능/불가/조건)와 근거가 문서에 기록된다.

### T2. 응답 계약 확정
- 조회 API 응답 스키마와 `errorFileCount`·`files` 정합성 불일치를 정리한다.
- 완료 기준: 확정된 응답 계약과 필드 정의가 합의된다.

### T3. Backend
- 오류 조회 API와 파일 1건 단위 재처리 API를 구성한다(기존 Service 재사용 전제).
- 재처리 직전 상태 재확인, 성공 시 `FILE_UPLOAD_DTTM` 갱신, 실패 시 원인 로그·오류 메시지 반환을 포함한다.
- 완료 기준: 조회/재처리 API가 원문 테스트 기준(정상 제외, 혼재 노출, USE_YN=N 제외, Skip, 중복 방지)을 충족한다.

### T4. Frontend
- 운영 메뉴에 첨부파일 업로드 오류 화면을 추가한다(검색·목록·Confirm·처리 중·성공/실패 안내).
- 완료 기준: 검색→조회→재처리→결과 표시 흐름이 동작하고 성공 시 해당 Row가 재조회된다.

### T5. 회귀·성능 검증
- 기존 등록/업로드 회귀 테스트, PRC/INS 각각 조회 검증, 대량 조회 응답시간·Oracle 실행계획을 확인한다.
- 완료 기준: 회귀 이상 없음이 확인되고 실행계획·응답시간 결과가 기록된다.

### 예상 변경 파일 (초안 근거)
```bash
dks-espec-portal
└─ src/views/.../AttachmentUploadError.vue
└─ src/api/attachment.ts

dks-espec-endpoint
└─ controller/AttachmentController.java
└─ service/AttachmentService.java
└─ repository/AttachmentRepository.java
└─ dto/AttachmentUploadErrorDto.java

Oracle
└─ 기존 RPT_DOC / ESPEC_ATTACH_FILE 조회
```

<!-- planrepo-visualization
{
  "schemaVersion": 1,
  "overview": {
    "headline": "eSPEC 첨부파일 업로드 오류 조회·재처리",
    "summary": "USE_YN=Y이면서 FILE_UPLOAD_DTTM이 없는 오류 첨부를 문서 단위로 조회하고 파일 1건 단위로 재처리하는 Inception 계획",
    "evidence": { "sectionId": "요구사항", "quote": "오류 판정: `ESPEC_ATTACH_FILE.USE_YN = 'Y' AND FILE_UPLOAD_DTTM IS NULL`" }
  },
  "changes": {
    "before": [],
    "after": ["Portal에서 오류 문서를 조회하고 파일 1건 단위로 재처리 결과를 확인"],
    "evidence": { "sectionId": "진행 계획", "quote": "파일 1건 단위 재처리 API를 구성한다" }
  },
  "nodes": [
    {
      "id": "node-1",
      "kind": "action",
      "title": "오류 문서 검색",
      "detail": "문서번호 / 기간 / 문서구분으로 오류 파일이 1건 이상인 문서를 조회",
      "evidence": { "sectionId": "사용자 시나리오", "quote": "검색영역에 문서번호 / 기간 / 문서구분(PRC/INS)을 입력한다" }
    },
    {
      "id": "node-2",
      "kind": "condition",
      "title": "재처리 전 상태 재확인",
      "detail": "이미 정상 처리된 건은 Skip 하고 동시 요청 중복 처리를 방지",
      "evidence": { "sectionId": "사용자 시나리오", "quote": "이미 정상 처리된 건은 Skip" }
    },
    {
      "id": "node-3",
      "kind": "result",
      "title": "재처리 성공",
      "detail": "FILE_UPLOAD_DTTM이 갱신되어 해당 Row가 재조회됨",
      "evidence": { "sectionId": "사용자 시나리오", "quote": "성공 시 `FILE_UPLOAD_DTTM`이 갱신되어 해당 Row가 재조회된다" }
    },
    {
      "id": "node-4",
      "kind": "result",
      "title": "재처리 실패",
      "detail": "원본 부재 시 실패 사유만 반환",
      "evidence": { "sectionId": "사용자 시나리오", "quote": "이번 범위에서는 실패 사유만 반환한다" }
    }
  ],
  "edges": [
    {
      "from": "node-1",
      "to": "node-2",
      "label": "오류 파일 선택 후 재처리 요청",
      "evidence": { "sectionId": "주요 구조", "quote": "재처리 API → 기존 파일 업로드 Service: 로직 재사용" }
    },
    {
      "from": "node-2",
      "to": "node-3",
      "label": "상태 정상이고 원본 접근 가능",
      "evidence": { "sectionId": "주요 구조", "quote": "재처리 성공 → ESPEC_ATTACH_FILE.FILE_UPLOAD_DTTM: 업로드 시각 갱신" }
    },
    {
      "from": "node-2",
      "to": "node-4",
      "label": "원본 부재·접근 불가",
      "evidence": { "sectionId": "사용자 시나리오", "quote": "원본 파일이 이미 삭제되었거나 접근 불가한 경우 재처리는 불가능" }
    }
  ],
  "scenarios": [
    {
      "id": "scenario-1",
      "label": "오류 조회와 성공 재처리",
      "description": "조건 검색으로 오류 문서를 조회하고 파일 1건을 재처리해 성공",
      "nodeIds": ["node-1", "node-3"],
      "outcome": "FILE_UPLOAD_DTTM 갱신 후 Row 재조회",
      "screen": {
        "title": "오류 목록",
        "body": "Grid에 문서번호, 오류 파일 수, 파일명, 상태, 재처리 버튼을 표시한다.",
        "primaryAction": "재처리",
        "evidence": { "sectionId": "사용자 시나리오", "quote": "Grid에 문서번호, 오류 파일 수, 파일명, 상태, 재처리 버튼을 표시한다" }
      },
      "evidence": { "sectionId": "사용자 시나리오", "quote": "오류 파일이 1건 이상인 문서가 목록에 노출되고" }
    },
    {
      "id": "scenario-2",
      "label": "이미 처리된 파일 Skip",
      "description": "재처리 직전 상태 재확인으로 이미 처리된 파일은 Skip",
      "nodeIds": ["node-2"],
      "outcome": "중복 업로드되지 않음",
      "evidence": { "sectionId": "사용자 시나리오", "quote": "이미 처리된 파일에 재요청 시 중복 업로드되지 않아야 한다" }
    },
    {
      "id": "scenario-3",
      "label": "원본 소실 실패",
      "description": "원본이 삭제·접근 불가하면 실패 사유만 반환",
      "nodeIds": ["node-4"],
      "outcome": "실패 사유 반환, 별도 조치 없음",
      "screen": {
        "title": "실패 안내",
        "body": "실패 시 서버 오류 메시지를 표시한다.",
        "status": "실패",
        "evidence": { "sectionId": "사용자 시나리오", "quote": "실패 시 서버 오류 메시지를 표시한다" }
      },
      "evidence": { "sectionId": "사용자 시나리오", "quote": "이번 범위에서는 실패 사유만 반환한다" }
    },
    {
      "id": "scenario-4",
      "label": "동시 요청·부분 실패",
      "description": "동시 요청은 상태 재검증으로 막고, 부분 실패는 rollback만으로 취소된다고 단정하지 않음",
      "nodeIds": ["node-2"],
      "outcome": "중복 처리 방지, 부분 실패는 검증 과제로 남김",
      "evidence": { "sectionId": "사용자 시나리오", "quote": "DB rollback만으로 외부 파일 저장이 취소된다고 단정하지 않는다" }
    }
  ],
  "rules": [
    {
      "id": "rule-1",
      "title": "오류 판정 조건",
      "detail": "USE_YN='Y' AND FILE_UPLOAD_DTTM IS NULL 인 파일만 오류로 판정",
      "category": "requirement",
      "evidence": { "sectionId": "요구사항", "quote": "`USE_YN = 'N'` 파일과 정상(업로드 시각이 있는) 파일은 오류 판정에서 제외한다" }
    },
    {
      "id": "rule-2",
      "title": "재처리 성공 기준",
      "detail": "재처리 성공 시 FILE_UPLOAD_DTTM이 생성되어야 함",
      "category": "success",
      "evidence": { "sectionId": "요구사항", "quote": "재처리 성공 시 `FILE_UPLOAD_DTTM`이 생성되어야 함" }
    },
    {
      "id": "rule-3",
      "title": "중복 업로드 방지",
      "detail": "이미 처리된 파일에 재요청 시 중복 업로드되지 않아야 함",
      "category": "exception",
      "evidence": { "sectionId": "요구사항", "quote": "이미 처리된 파일에 재요청 시 중복 업로드되지 않아야 함" }
    }
  ]
}
-->
