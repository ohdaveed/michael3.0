// === ESTATE READINESS QUIZ ===
(function () {
  const startView = document.getElementById("quizStartView");
  const questionsView = document.getElementById("quizQuestionsView");
  const resultView = document.getElementById("quizResultView");
  const startBtn = document.getElementById("quizStartBtn");
  const progressFill = document.getElementById("quizProgressFill");
  const progressLabel = document.getElementById("quizProgressLabel");
  const progressBar = document.getElementById("quizProgress");
  const questionArea = document.getElementById("quizQuestionArea");

  if (!startView || !questionsView || !resultView || !startBtn) return;

  const questions = [
    {
      text: "Do you have a living trust or will already in place?",
      gapAnchor: "services.html#living-trusts",
      gapLabel: "Explore Living Trusts",
    },
    {
      text: "Has your estate plan been reviewed in the last 3 years?",
      gapAnchor: "services.html#estate-planning",
      gapLabel: "Explore Estate Planning",
    },
    {
      text: "Do you have a healthcare directive and durable power of attorney?",
      gapAnchor: "services.html#wills-powers-of-attorney",
      gapLabel: "Explore Wills & Powers of Attorney",
    },
    {
      text: "Are beneficiaries clearly named on all your accounts and insurance policies?",
      gapAnchor: "services.html#funding-checklist",
      gapLabel: "See the Trust Funding Checklist",
    },
    {
      text: "Have you set up a guardianship plan or provisions for dependents?",
      gapAnchor: "services.html#estate-planning",
      gapLabel: "Explore Estate Planning",
    },
  ];

  let current = 0;
  let noCount = 0;
  let firstGap = null;

  function showQuestion(index) {
    const currentQuestion = index + 1;
    const pct = Math.round((currentQuestion / questions.length) * 100);
    progressFill.style.width = pct + "%";
    progressBar.setAttribute("aria-valuenow", currentQuestion);
    progressBar.setAttribute("aria-valuemax", questions.length);
    progressLabel.textContent =
      "Question " + currentQuestion + " of " + questions.length;

    var questionText = questions[index].text;
    questionArea.innerHTML =
      '<p class="quiz-question-text">' +
      questionText +
      "</p>" +
      '<div class="quiz-options">' +
      '<button type="button" class="quiz-option-btn" data-answer="yes" aria-label="Yes: ' +
      questionText +
      '">Yes</button>' +
      '<button type="button" class="quiz-option-btn" data-answer="no" aria-label="No or not sure: ' +
      questionText +
      '">No / Not sure</button>' +
      "</div>";

    questionArea.querySelectorAll(".quiz-option-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (this.dataset.answer === "no") {
          noCount++;
          if (!firstGap) firstGap = questions[index];
        }
        current++;
        if (current < questions.length) {
          showQuestion(current);
        } else {
          showResult();
        }
      });
    });

    var firstOptionButton = questionArea.querySelector(".quiz-option-btn");
    if (firstOptionButton) {
      firstOptionButton.focus();
    }
  }

  function showResult() {
    questionsView.hidden = true;
    resultView.hidden = false;

    var score = questions.length - noCount;
    var message, detail, urgencyClass;

    // Tiering: 0 gaps reads as "well-prepared", 1-2 as a few fixable gaps,
    // 3+ (out of 5 questions) as significant exposure worth an urgent call.
    if (noCount === 0) {
      message = "Your estate looks well-prepared.";
      detail =
        "You've checked all the key boxes. Schedule a free review with Michael to make sure nothing has changed and your documents are fully up to date.";
      urgencyClass = "quiz-result--good";
    } else if (noCount <= 2) {
      message =
        "You have " +
        noCount +
        " gap" +
        (noCount > 1 ? "s" : "") +
        " worth addressing.";
      detail =
        "A few missing pieces could leave your family exposed. A free consultation with Michael can identify exactly what's needed and how to fix it quickly.";
      urgencyClass = "quiz-result--medium";
    } else {
      message = "Your estate has " + noCount + " significant gaps.";
      detail =
        "Without these protections, probate can mean months in court, minimum statutory fees, and avoidable pressure on your family. A free consultation can identify the biggest gaps quickly.";
      urgencyClass = "quiz-result--urgent";
    }

    var actionsHtml;
    if (firstGap) {
      // Route to the most relevant service first (lower commitment than
      // booking outright), with consultation as the secondary action.
      actionsHtml =
        '<div class="quiz-result-actions">' +
        '<a href="' +
        firstGap.gapAnchor +
        '" class="btn-primary">' +
        firstGap.gapLabel +
        " →</a>" +
        '<a href="contact.html#contact" class="btn-secondary">Book a Free Consultation →</a>' +
        "</div>";
    } else {
      actionsHtml =
        '<div class="quiz-result-actions">' +
        '<a href="contact.html#contact" class="btn-primary">Book a Free Consultation →</a>' +
        "</div>";
    }

    resultView.className = "quiz-result-view " + urgencyClass;
    resultView.innerHTML =
      '<div class="quiz-result-score">' +
      score +
      "/" +
      questions.length +
      "</div>" +
      '<p class="quiz-result-score-label">Estate readiness score</p>' +
      '<p class="quiz-result-message">' +
      message +
      "</p>" +
      '<p class="quiz-result-detail">' +
      detail +
      "</p>" +
      actionsHtml +
      '<button type="button" class="quiz-retake-btn" id="quizRetakeBtn">Retake the check</button>';

    resultView
      .querySelector("#quizRetakeBtn")
      .addEventListener("click", resetQuiz);
  }

  function resetQuiz() {
    current = 0;
    noCount = 0;
    firstGap = null;
    resultView.hidden = true;
    resultView.innerHTML = "";
    startView.hidden = false;
  }

  startBtn.addEventListener("click", function () {
    startView.hidden = true;
    questionsView.hidden = false;
    showQuestion(0);
  });
})();
