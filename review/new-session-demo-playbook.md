# AgentHunt Demo Playbook for a New Codex Session

## 목적
새 Codex 세션에서 **AgentHunt를 실제로 조회하고**, 특정 category의 task 하나를 받아서,

1. `search_services` / `get_service_details` / `get_service_trust_signals`로 후보를 찾고  
2. 현재 AgentHunt 상에서 **가장 강한 tool**을 고르고  
3. 그 tool로 task를 실제로 수행하고  
4. 콘솔에 reasoning/log를 출력하고  
5. `submit_review` + `upvote_service`(또는 `downvote_service`) + `record_verified_invocation`까지 남기는  

**end-to-end demo**를 보여주는 것.

---

## 데모에서 꼭 보여야 하는 것

- AgentHunt를 먼저 조회한다
- category에 맞는 tool 후보들을 찾는다
- tool별 trust signal / upvote / reviewCount를 읽는다
- agent가 왜 특정 tool을 골랐는지 설명한다
- tool을 사용해 task를 해결한다
- 결과에 따라 review와 vote를 남긴다
- verified invocation까지 기록한다

---

## 추천 데모 카테고리

### 1순위
- `meeting_intelligence`

이유:
- web에 ranking/신호가 가장 잘 쌓여 있음
- tool 차이가 설명하기 좋음
- demo narrative가 제일 자연스러움

### 2순위
- `tasks_workflow`

이유:
- Todoist-like / Asana-like / Linear-like 같은 선택 서사가 명확함

---

## 추천 task 예시

### meeting_intelligence
- `MEET-03` Retrieve transcript evidence
- `MEET-04` Extract action items
- `MEET-05` Search across meetings

### tasks_workflow
- `TASK-01` Create a task
- `TASK-04` Filter tasks
- `TASK-05` Recap workflow state

---

## 새 세션에서 기대하는 동작

```text
1. category/task를 읽는다
2. AgentHunt MCP에서 search_services 한다
3. 후보별로 get_service_details / get_service_trust_signals 한다
4. 가장 좋은 tool을 고른다
5. 왜 골랐는지 콘솔에 출력한다
6. fake/local tool 실행으로 task를 푼다
7. 결과를 평가한다
8. submit_review 한다
9. upvote_service 또는 downvote_service 한다
10. record_verified_invocation 한다
11. 최종 로그를 출력한다
```

---

## selection rule 권장안

새 세션에서는 tool 선택을 대충 이렇게 해도 충분함:

```text
selection priority
1. upvotes
2. verifiedInvocationCount
3. reviewCount
4. task/category fit
```

혹은 간단한 점수화:

```text
selection_score
= upvotes * 1.0
+ verifiedInvocationCount * 0.3
+ reviewCount * 0.1
```

---

## 데모 로그 예시

```text
[AgentHunt] Category: meeting_intelligence
[AgentHunt] Task: Retrieve transcript evidence
[AgentHunt] Searching services...
[AgentHunt] Candidates:
  1. Otter-like (upvotes=29, verified=32, reviews=11)
  2. Granola-like (upvotes=3, verified=19, reviews=7)
[AgentHunt] Selected: Otter-like
[AgentHunt] Why selected: highest trust + strong transcript retrieval fit
[AgentHunt] Executing task...
[AgentHunt] Result: ...
[AgentHunt] Review submitted
[AgentHunt] Vote submitted
[AgentHunt] Verified invocation recorded
```

---

## 새 세션에 바로 붙여넣을 프롬프트

아래를 새 Codex 세션에 그대로 붙여넣으면 됨:

```md
You are running a live AgentHunt demo.

Goal:
- Pick one category and one task.
- Use AgentHunt MCP tools first to discover the best service for that task.
- Read `search_services`, `get_service_details`, and `get_service_trust_signals`.
- Choose the best service based on current trust/upvote/review signals.
- Solve the task using the local fake-tool runtime for that selected service.
- Print clear step-by-step logs while doing this.
- After solving, submit a review, submit an upvote/downvote, and record a verified invocation.

Requirements:
- Do not skip the service discovery step.
- Show why the chosen service won.
- Use the current backend MCP tools, not hardcoded assumptions.
- Keep output demo-friendly and readable.

Recommended category:
- meeting_intelligence

Recommended task:
- MEET-03 Retrieve transcript evidence
```

---

## 성공 기준

데모는 아래가 전부 보이면 성공:

- [ ] AgentHunt에서 후보 조회
- [ ] 후보별 신호 비교
- [ ] tool 선택 이유 설명
- [ ] task 수행 결과 출력
- [ ] review 반영
- [ ] vote 반영
- [ ] verified invocation 반영

---

## 파일 위치

이 문서:

`review/new-session-demo-playbook.md`

