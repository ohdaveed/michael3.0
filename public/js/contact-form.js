import JustValidate from "just-validate";
import productContract from "./product-contract.json";

// Contact Form Handler with Web3Forms & JustValidate
const contactForm = document.getElementById("contactForm");
const formMessage = document.getElementById("formMessage");

if (contactForm && formMessage) {
  const validator = new JustValidate(contactForm, {
    errorFieldCssClass: "is-invalid",
    errorLabelCssClass: "just-validate-error-label",
    errorLabelStyle: {
      color: "var(--error)",
      fontSize: "0.85rem",
      marginTop: "0.25rem",
      display: "block",
    },
  });

  validator
    .addField("#fname", [
      {
        rule: "required",
        errorMessage: "First name is required.",
      },
    ])
    .addField("#lname", [
      {
        rule: "required",
        errorMessage: "Last name is required.",
      },
    ])
    .addField("#email", [
      {
        rule: "required",
        errorMessage: "Email is required.",
      },
      {
        rule: "email",
        errorMessage: "Please enter a valid email address.",
      },
    ])
    .addField("#service", [
      {
        rule: "required",
        errorMessage: "Please choose a service, or select “Not sure yet.”",
      },
    ])
    .addField("#message", [
      {
        rule: "required",
        errorMessage: "Message is required.",
      },
    ])
    .onSuccess(async () => {
      const submitButton = contactForm.querySelector('button[type="submit"]');
      if (!submitButton) return;

      const originalButtonText = submitButton.textContent;

      submitButton.disabled = true;
      submitButton.textContent = "Sending...";

      formMessage.textContent = "";
      formMessage.className = "form-message";
      formMessage.setAttribute("role", "status");

      // Intake parsing contract (see the HTML comment above the form): the
      // Power Automate flow filters on the "[INTAKE]" subject prefix and
      // reads both the stable product code and its display label.
      const productCode = contactForm.querySelector(
        'select[name="product_code"]',
      ).value;
      const product = productContract.products.find(
        (p) => p.code === productCode,
      );
      const productLabel = product ? product.label : productCode;
      contactForm.querySelector('input[name="service"]').value = productLabel;
      const firstName = contactForm.querySelector("#fname").value.trim();
      const lastName = contactForm.querySelector("#lname").value.trim();
      contactForm.querySelector('input[name="subject"]').value =
        `[INTAKE] ${productLabel} — ${firstName} ${lastName}`;

      let leavePage = false;
      try {
        const formData = new FormData(contactForm);
        const response = await fetch("https://api.web3forms.com/submit", {
          method: "POST",
          body: formData,
        });

        const data = await response.json();

        if (data.success) {
          leavePage = true;
          // Codes only — never send names, emails, phones, or message
          // content to analytics.
          if (typeof window.gtag === "function") {
            window.gtag("event", "generate_lead", {
              method: "contact_form",
              product_code: productCode,
            });
          }
          const thankYou = new URL("thank-you.html", window.location.href);
          window.location.assign(thankYou.href);
          return;
        } else {
          throw new Error(data.message || "Form submission failed");
        }
      } catch (error) {
        formMessage.textContent =
          "There was an error sending your message. Please try again in a moment, or email michael@lehr-law.com directly.";
        formMessage.className = "form-message error";
        formMessage.setAttribute("role", "alert");
        console.error("Form submission error:", error);
      } finally {
        if (!leavePage) {
          submitButton.disabled = false;
          submitButton.textContent = originalButtonText;
        }
      }
    });
}
