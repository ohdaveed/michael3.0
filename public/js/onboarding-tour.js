import { driver } from "driver.js";
import "driver.js/dist/driver.css";

// Interactive Onboarding Tour using driver.js
// Walks a visitor through the six #step-* cards on process.html; gated on
// #start-tour-btn existing so this is a no-op on every other page.
(function () {
  const startBtn = document.getElementById("start-tour-btn");
  if (!startBtn) return;

  startBtn.addEventListener("click", () => {
    const driverObj = driver({
      showProgress: true,
      allowClose: true,
      animate: true,
      overlayColor: "rgba(10, 25, 47, 0.85)", // Deep navy matching site theme
      steps: [
        {
          element: "#start-tour-btn",
          popover: {
            title: "Welcome to the Guided Tour!",
            description:
              "Let's walk through the six simple steps we use to build your custom estate plan and secure your peace of mind.",
            side: "bottom",
            align: "center",
          },
        },
        {
          element: "#step-consultation",
          popover: {
            title: "Step 1: Free Consultation",
            description:
              "We meet for 45-60 minutes (in office, at your home, or remotely) to review your assets, goals, and quote an upfront flat fee.",
            side: "top",
            align: "start",
          },
        },
        {
          element: "#step-design",
          popover: {
            title: "Step 2: Designing Your Plan",
            description:
              "You complete a secure questionnaire. We then design the custom blueprint for your wills, trusts, and healthcare directives.",
            side: "top",
            align: "start",
          },
        },
        {
          element: "#step-drafting",
          popover: {
            title: "Step 3: Drafting & Revisions",
            description:
              "We draft your documents and provide unlimited reviews. We make revisions until you understand and approve every clause.",
            side: "top",
            align: "start",
          },
        },
        {
          element: "#step-signing",
          popover: {
            title: "Step 4: The Signing Ceremony",
            description:
              "We gather in person with witnesses and a notary to properly execute your documents, ensuring they are fully legally binding.",
            side: "top",
            align: "start",
          },
        },
        {
          element: "#step-implementation",
          popover: {
            title: "Step 5: Funding Your Trust",
            description:
              "Important: We prepare new real estate deeds and coach you step-by-step on retitling bank and brokerage accounts into your trust.",
            side: "top",
            align: "start",
          },
        },
        {
          element: "#step-ongoing",
          popover: {
            title: "Step 6: Ongoing Support",
            description:
              "As your life evolves (births, marriages, moves, or major purchases), we update your plan to ensure it always protects your legacy.",
            side: "top",
            align: "start",
          },
        },
        {
          element: ".process-cta",
          popover: {
            title: "Begin Your Plan Today",
            description:
              "Ready to take the first step? Send Michael a message to schedule your free consultation.",
            side: "top",
            align: "center",
          },
        },
      ],
    });
    driverObj.drive();
  });
})();
