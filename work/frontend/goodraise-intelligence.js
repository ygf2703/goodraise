function createGoodRaiseIntelligence(deps) {
  const groupBy = deps.groupBy;
  const sumAmount = deps.sumAmount;
  const buildLeaderboard = deps.buildLeaderboard;

  function toMillis(value) {
    const timestamp = Date.parse(value || "");
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function unique(values) {
    return [...new Set((values || []).filter(Boolean))];
  }

  function latestIso(rows) {
    return [...rows]
      .map((row) => row.createdIso)
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || "";
  }

  function ensureExplicitCampaignContext(context) {
    const organizationId = String(context?.organizationId || "").trim();
    const campaignId = String(context?.campaignId || "").trim();
    if (!organizationId || !campaignId) {
      throw new Error("GoodRaise Intelligence requires explicit organizationId and campaignId context.");
    }
    return {
      ...(context && typeof context === "object" ? context : {}),
      organizationId,
      campaignId,
    };
  }

  function getReferenceRowsBeforeLatestDate(rows) {
    const latest = latestIso(rows);
    if (!latest) {
      return [];
    }
    const latestDate = latest.slice(0, 10);
    return rows.filter((row) => row.date && row.date < latestDate);
  }

  function getCampaignBounds(rows, meta) {
    const knownDates = unique([...(meta?.projectDates || []), ...(meta?.uniqueDates || []), ...rows.map((row) => row.date)]);
    const sortedDates = knownDates.sort();
    const startDate = sortedDates[0] || "";
    const endDate = sortedDates[sortedDates.length - 1] || startDate || "";
    const startMillis = startDate ? Date.parse(`${startDate}T00:00:00`) : 0;
    const endMillis = endDate ? Date.parse(`${endDate}T23:59:59`) : startMillis;
    const latestCreatedIso = latestIso(rows);
    const latestMillis = toMillis(latestCreatedIso) || endMillis || startMillis;
    const elapsedHours = startMillis && latestMillis >= startMillis ? Math.max(1, (latestMillis - startMillis) / 3600000) : 1;
    const totalHours = startMillis && endMillis >= startMillis ? Math.max(elapsedHours, (endMillis - startMillis) / 3600000) : elapsedHours;
    const remainingHours = Math.max(0, totalHours - elapsedHours);
    const elapsedRatio = totalHours > 0 ? clamp(elapsedHours / totalHours, 0, 1) : 0;
    return {
      startDate,
      endDate,
      latestCreatedIso,
      latestMillis,
      elapsedHours,
      totalHours,
      remainingHours,
      elapsedRatio,
    };
  }

  function rowsWithinHours(rows, latestMillis, fromHoursAgo, toHoursAgo) {
    const fromMillis = latestMillis - fromHoursAgo * 3600000;
    const toMillisBoundary = latestMillis - toHoursAgo * 3600000;
    return rows.filter((row) => {
      const createdMillis = toMillis(row.createdIso);
      return createdMillis > fromMillis && createdMillis <= toMillisBoundary;
    });
  }

  function buildVelocityModel(rows, context) {
    const scopedContext = ensureExplicitCampaignContext(context);
    const bounds = getCampaignBounds(rows, scopedContext.meta);
    const lastHourRows = rowsWithinHours(rows, bounds.latestMillis, 1, 0);
    const last3HourRows = rowsWithinHours(rows, bounds.latestMillis, 3, 0);
    const previous3HourRows = rowsWithinHours(rows, bounds.latestMillis, 6, 3);
    const recent12HourRows = rowsWithinHours(rows, bounds.latestMillis, 12, 0);
    const previous12HourRows = rowsWithinHours(rows, bounds.latestMillis, 24, 12);
    const latestDate = bounds.latestCreatedIso ? bounds.latestCreatedIso.slice(0, 10) : "";
    const todayRows = latestDate ? rows.filter((row) => row.date === latestDate) : rows;
    const previousDate = unique(rows.map((row) => row.date).filter((date) => date && date < latestDate)).sort().slice(-1)[0] || "";
    const previousDateRows = previousDate ? rows.filter((row) => row.date === previousDate) : [];
    const totalAmount = sumAmount(rows);
    const totalDeals = rows.length;
    const campaignAverageAmountPerHour = bounds.elapsedHours ? totalAmount / bounds.elapsedHours : 0;
    const campaignAverageDealsPerHour = bounds.elapsedHours ? totalDeals / bounds.elapsedHours : 0;
    const last3Amount = sumAmount(last3HourRows);
    const previous3Amount = sumAmount(previous3HourRows);
    const last3Deals = last3HourRows.length;
    const previous3Deals = previous3HourRows.length;
    return {
      bounds,
      currentHour: {
        amount: sumAmount(lastHourRows),
        deals: lastHourRows.length,
      },
      last3Hours: {
        amount: last3Amount,
        deals: last3Deals,
        amountPerHour: last3Amount / 3,
        dealsPerHour: last3Deals / 3,
      },
      previous3Hours: {
        amount: previous3Amount,
        deals: previous3Deals,
        amountPerHour: previous3Amount / 3,
        dealsPerHour: previous3Deals / 3,
      },
      recent12Hours: {
        amount: sumAmount(recent12HourRows),
        deals: recent12HourRows.length,
      },
      previous12Hours: {
        amount: sumAmount(previous12HourRows),
        deals: previous12HourRows.length,
      },
      today: {
        amount: sumAmount(todayRows),
        deals: todayRows.length,
      },
      previousDate: {
        amount: sumAmount(previousDateRows),
        deals: previousDateRows.length,
      },
      campaignAverage: {
        amountPerHour: campaignAverageAmountPerHour,
        dealsPerHour: campaignAverageDealsPerHour,
      },
      changeVsPrevious3Hours: {
        amountRatio: previous3Amount > 0 ? (last3Amount - previous3Amount) / previous3Amount : 0,
        dealsRatio: previous3Deals > 0 ? (last3Deals - previous3Deals) / previous3Deals : 0,
      },
    };
  }

  function getAmbassadorDirectoryMap(directory) {
    const map = new Map();
    (directory || []).forEach((record) => {
      const name = String(record?.fullName || "").trim();
      if (name) {
        map.set(name, record);
      }
    });
    return map;
  }

  function getNextPrizeThreshold(amount, prizeModel) {
    const tiers = [...(prizeModel?.tierPrizes || [])]
      .map((tier) => Number(tier?.threshold || 0))
      .filter((threshold) => Number.isFinite(threshold) && threshold > amount)
      .sort((left, right) => left - right);
    return tiers[0] || 0;
  }

  function buildAmbassadorModels(rows, context) {
    const scopedContext = ensureExplicitCampaignContext(context);
    const directory = scopedContext.ambassadorDirectory || [];
    const directoryMap = getAmbassadorDirectoryMap(directory);
    const bounds = getCampaignBounds(rows, scopedContext.meta);
    const perAmbassador = groupBy(rows.filter((row) => row.ambassador && row.ambassador !== "ללא שיוך"), (row) => row.ambassador);
    const allNames = unique([...directory.map((record) => String(record.fullName || "").trim()), ...Array.from(perAmbassador.keys())]).sort((left, right) => left.localeCompare(right, "he"));
    const fullLeaderboard = buildLeaderboard(rows);
    const previousLeaderboard = buildLeaderboard(getReferenceRowsBeforeLatestDate(rows));
    const currentRanks = new Map(fullLeaderboard.map((entry, index) => [entry.ambassador, index + 1]));
    const previousRanks = new Map(previousLeaderboard.map((entry, index) => [entry.ambassador, index + 1]));
    const goalFallback = Number(scopedContext.goals?.ambassadorGoal || scopedContext.campaignBuilder?.goals?.ambassadorGoal || 0);

    return allNames.map((name) => {
      const ambassadorRows = perAmbassador.get(name) || [];
      const total = sumAmount(ambassadorRows);
      const donations = ambassadorRows.length;
      const firstDonation = ambassadorRows.map((row) => row.createdIso).filter(Boolean).sort()[0] || "";
      const lastDonation = ambassadorRows.map((row) => row.createdIso).filter(Boolean).sort().slice(-1)[0] || "";
      const lastMillis = toMillis(lastDonation);
      const hoursSinceActivity = lastMillis ? Math.max(0, (bounds.latestMillis - lastMillis) / 3600000) : bounds.elapsedHours;
      const recent6HourRows = rowsWithinHours(ambassadorRows, bounds.latestMillis, 6, 0);
      const previous6HourRows = rowsWithinHours(ambassadorRows, bounds.latestMillis, 12, 6);
      const recent6Amount = sumAmount(recent6HourRows);
      const previous6Amount = sumAmount(previous6HourRows);
      const trend = recent6Amount > previous6Amount ? "up" : recent6Amount < previous6Amount ? "down" : "flat";
      const directoryRecord = directoryMap.get(name) || {};
      const target = Number(directoryRecord.personalTarget || goalFallback || 0);
      const targetProgress = target > 0 ? total / target : 0;
      const nextPrizeThreshold = getNextPrizeThreshold(total, scopedContext.prizeModel);
      const prizeGap = nextPrizeThreshold > 0 ? Math.max(0, nextPrizeThreshold - total) : 0;
      const currentRank = currentRanks.get(name) || 0;
      const previousRank = previousRanks.get(name) || 0;
      let status = "Active";
      if (target > 0 && total >= target) {
        status = "Target Reached";
      } else if (!donations) {
        status = "Inactive";
      } else if (hoursSinceActivity >= 12 || (recent6Amount === 0 && previous6Amount > 0)) {
        status = "Needs Attention";
      } else if (recent6Amount > 0 && targetProgress >= 0.6) {
        status = "Hot";
      }

      return {
        ambassador: name,
        total,
        target,
        targetProgress,
        donations,
        averageDonation: donations ? total / donations : 0,
        firstDonation,
        lastDonation,
        hoursSinceActivity,
        velocityPerHour: recent6Amount / 6,
        trend,
        rank: currentRank,
        rankChange: previousRank && currentRank ? previousRank - currentRank : 0,
        prizeGap,
        nextPrizeThreshold,
        team: String(directoryRecord.team || "").trim(),
        status,
        email: String(directoryRecord.email || "").trim().toLowerCase(),
        phone: String(directoryRecord.phone || "").trim(),
        hasStarted: donations > 0,
      };
    });
  }

  function buildForecastModel(rows, context) {
    const scopedContext = ensureExplicitCampaignContext(context);
    const bounds = getCampaignBounds(rows, scopedContext.meta);
    const velocity = buildVelocityModel(rows, scopedContext);
    const total = sumAmount(rows);
    const target = Number(scopedContext.goals?.total || 0);
    const weightedAmountPerHour = velocity.previous3Hours.amount > 0
      ? velocity.last3Hours.amountPerHour * 0.6 + velocity.campaignAverage.amountPerHour * 0.4
      : velocity.campaignAverage.amountPerHour;
    const projectedFinal = total + weightedAmountPerHour * bounds.remainingHours;
    let confidence = "low";
    if (rows.length >= 120 && bounds.elapsedRatio >= 0.35) {
      confidence = "high";
    } else if (rows.length >= 40 && bounds.elapsedRatio >= 0.2) {
      confidence = "medium";
    }
    return {
      projectedFinal,
      projectedTargetPct: target > 0 ? projectedFinal / target : 0,
      gapOrSurplus: target > 0 ? projectedFinal - target : 0,
      currentTrajectory: weightedAmountPerHour,
      confidence,
      confidenceReason:
        confidence === "high"
          ? "קיימים מספיק נתונים לאורך חלון משמעותי של הקמפיין."
          : confidence === "medium"
            ? "יש בסיס סביר לחיזוי, אך נדרשת זהירות."
            : "Low confidence - insufficient campaign history.",
    };
  }

  function buildHealthModel(rows, context) {
    const scopedContext = ensureExplicitCampaignContext(context);
    const total = sumAmount(rows);
    const bounds = getCampaignBounds(rows, scopedContext.meta);
    const velocity = buildVelocityModel(rows, scopedContext);
    const ambassadors = buildAmbassadorModels(rows, scopedContext);
    const target = Number(scopedContext.goals?.total || 0);
    const dailyGoal = Number(scopedContext.goals?.daily || 0);
    const progressRatio = target > 0 ? total / target : 0;
    const paceGap = progressRatio - bounds.elapsedRatio;
    const failedCount = rows.filter((row) => row.status === "failed").length;
    const failedRate = rows.length ? failedCount / rows.length : 0;
    const inactiveAmbassadors = ambassadors.filter((item) => item.status === "Inactive").length;
    const attentionAmbassadors = ambassadors.filter((item) => item.status === "Needs Attention").length;
    const todayGap = dailyGoal > 0 ? dailyGoal - velocity.today.amount : 0;

    let score = 100;
    const reasons = [];
    if (paceGap < -0.1) {
      const penalty = Math.round(Math.min(25, Math.abs(paceGap) * 100));
      score -= penalty;
      reasons.push({ tone: "negative", text: `קצב הקמפיין נמוך בכ-${Math.round(Math.abs(paceGap) * 100)}% מהמסלול הנדרש.` });
    } else if (paceGap > 0.08) {
      score += 4;
      reasons.push({ tone: "positive", text: `הקמפיין מתקדם מהר בכ-${Math.round(paceGap * 100)}% מהמסלול הנדרש.` });
    }
    if (velocity.changeVsPrevious3Hours.amountRatio < -0.15) {
      score -= 15;
      reasons.push({ tone: "negative", text: `מהירות הגיוס ירדה ב-${Math.round(Math.abs(velocity.changeVsPrevious3Hours.amountRatio) * 100)}% לעומת 3 השעות הקודמות.` });
    } else if (velocity.changeVsPrevious3Hours.amountRatio > 0.08) {
      score += 5;
      reasons.push({ tone: "positive", text: `מהירות הגיוס השתפרה ב-${Math.round(velocity.changeVsPrevious3Hours.amountRatio * 100)}% לעומת 3 השעות הקודמות.` });
    }
    if (inactiveAmbassadors > 0) {
      const penalty = Math.min(18, inactiveAmbassadors * 2);
      score -= penalty;
      reasons.push({ tone: "negative", text: `${inactiveAmbassadors} שגרירים עדיין לא ייצרו תרומה.` });
    }
    if (attentionAmbassadors > 0) {
      score -= Math.min(10, attentionAmbassadors);
      reasons.push({ tone: "negative", text: `${attentionAmbassadors} שגרירים נמצאים במצב Needs Attention.` });
    }
    if (failedRate > 0.08) {
      score -= 12;
      reasons.push({ tone: "negative", text: `שיעור כשלי עסקאות עומד על ${Math.round(failedRate * 100)}%.` });
    }
    if (dailyGoal > 0 && todayGap > 0) {
      score -= Math.min(12, Math.round((todayGap / dailyGoal) * 10));
      reasons.push({ tone: "negative", text: `חסרים ${Math.round(todayGap)} מול היעד היומי.` });
    }

    score = clamp(Math.round(score), 0, 100);
    let label = "Critical";
    if (score >= 85) {
      label = "Excellent";
    } else if (score >= 70) {
      label = "Healthy";
    } else if (score >= 55) {
      label = "Needs Attention";
    } else if (score >= 35) {
      label = "At Risk";
    }

    return {
      score,
      label,
      paceGap,
      failedRate,
      todayGap,
      reasons: reasons.slice(0, 4),
    };
  }

  function buildPriorityList(rows, context) {
    const scopedContext = ensureExplicitCampaignContext(context);
    const ambassadors = buildAmbassadorModels(rows, scopedContext);
    const priorities = [];
    ambassadors.forEach((item) => {
      if (!item.hasStarted) {
        priorities.push({
          ambassador: item.ambassador,
          score: 100,
          reason: "לא התחיל/ה לגייס כלל",
          action: "פנייה לפתיחת גיוס ראשונה",
          status: item.status,
        });
      }
      if (item.target > 0 && item.target - item.total > 0 && item.target - item.total <= Math.max(500, item.target * 0.1)) {
        priorities.push({
          ambassador: item.ambassador,
          score: 85,
          reason: `קרוב/ה ליעד אישי עם פער של ${Math.round(item.target - item.total)}.`,
          action: "לעודד סגירת יעד אישי",
          status: item.status,
        });
      }
      if (item.prizeGap > 0 && item.prizeGap <= 500) {
        priorities.push({
          ambassador: item.ambassador,
          score: 78,
          reason: `קרוב/ה למדרגת פרס הבאה עם פער של ${Math.round(item.prizeGap)}.`,
          action: "פנייה סביב מדרגת הפרס הקרובה",
          status: item.status,
        });
      }
      if (item.hoursSinceActivity >= 10 && item.total > 0) {
        priorities.push({
          ambassador: item.ambassador,
          score: 72,
          reason: `ללא תרומה במשך ${Math.round(item.hoursSinceActivity)} שעות.`,
          action: "שיחת חידוש מומנטום",
          status: item.status,
        });
      }
      if (item.trend === "down" && item.total > 0) {
        priorities.push({
          ambassador: item.ambassador,
          score: 64,
          reason: "קצב הגיוס האישי ירד בטווח של 6 שעות.",
          action: "בדיקת חסם/תמיכה מהירה",
          status: item.status,
        });
      }
    });
    return priorities.sort((left, right) => right.score - left.score).slice(0, 8);
  }

  function buildAttentionNow(rows, context) {
    const scopedContext = ensureExplicitCampaignContext(context);
    const ambassadors = buildAmbassadorModels(rows, scopedContext);
    const velocity = buildVelocityModel(rows, scopedContext);
    const health = buildHealthModel(rows, scopedContext);
    const priorityList = buildPriorityList(rows, scopedContext);
    const items = [];
    const notStarted = ambassadors.filter((item) => !item.hasStarted);
    const nearPrize = ambassadors.filter((item) => item.prizeGap > 0 && item.prizeGap <= 500);
    const needsAttention = ambassadors.filter((item) => item.status === "Needs Attention");
    const recentFailed = rowsWithinHours(rows.filter((row) => row.status === "failed"), velocity.bounds.latestMillis, 2, 0);

    if (notStarted.length) {
      items.push({
        severity: 100,
        issue: `${notStarted.length} שגרירים עדיין ללא תרומה ראשונה.`,
        evidence: `מתוך ${ambassadors.length} שגרירים מזוהים, ${notStarted.length} עדיין לא הופעלו.`,
        entities: notStarted.slice(0, 4).map((item) => item.ambassador),
        action: "פתיחת רשימת שגרירים לא-מופעלים",
      });
    }
    if (velocity.changeVsPrevious3Hours.amountRatio < -0.15) {
      items.push({
        severity: 92,
        issue: `מהירות הגיוס ירדה ב-${Math.round(Math.abs(velocity.changeVsPrevious3Hours.amountRatio) * 100)}% לעומת התקופה המקבילה.`,
        evidence: `3 השעות האחרונות: ${Math.round(velocity.last3Hours.amount)} לעומת ${Math.round(velocity.previous3Hours.amount)} קודם.`,
        entities: [],
        action: "ניתוח האטה וחיפוש שגרירים עם ירידה חדה",
      });
    }
    if (health.todayGap > 0) {
      items.push({
        severity: 84,
        issue: `חסרים ${Math.round(health.todayGap)} ליעד היומי.`,
        evidence: `גויסו היום ${Math.round(velocity.today.amount)} לעומת יעד של ${Math.round(scopedContext.goals?.daily || 0)}.`,
        entities: priorityList.slice(0, 3).map((item) => item.ambassador),
        action: "מעבר לרשימת ההזדמנויות המובילות",
      });
    }
    if (nearPrize.length) {
      items.push({
        severity: 76,
        issue: `${nearPrize.length} שגרירים קרובים למדרגת הפרס הבאה.`,
        evidence: nearPrize.slice(0, 3).map((item) => `${item.ambassador}: ${Math.round(item.prizeGap)} חסרים`).join(" | "),
        entities: nearPrize.slice(0, 4).map((item) => item.ambassador),
        action: "פנייה ממוקדת סביב פרסים קרובים",
      });
    }
    if (recentFailed.length) {
      items.push({
        severity: 70,
        issue: `${recentFailed.length} עסקאות נכשלו בשעתיים האחרונות.`,
        evidence: `סכום העסקאות שנכשלו: ${Math.round(sumAmount(recentFailed))}.`,
        entities: unique(recentFailed.map((row) => row.donor)).slice(0, 4),
        action: "בדיקת כשלים וייצוא מעקב",
      });
    }
    if (needsAttention.length) {
      items.push({
        severity: 62,
        issue: `${needsAttention.length} שגרירים במצב Needs Attention.`,
        evidence: needsAttention.slice(0, 4).map((item) => `${item.ambassador}: ${Math.round(item.hoursSinceActivity)} שעות ללא פעילות`).join(" | "),
        entities: needsAttention.slice(0, 4).map((item) => item.ambassador),
        action: "פתיחת רשימת שגרירים להחייאת פעילות",
      });
    }

    return items.sort((left, right) => right.severity - left.severity).slice(0, 6);
  }

  function buildFingerprint(rows, context) {
    const scopedContext = ensureExplicitCampaignContext(context);
    const velocity = buildVelocityModel(rows, scopedContext);
    const ambassadors = buildAmbassadorModels(rows, scopedContext);
    const total = sumAmount(rows);
    const target = Number(scopedContext.goals?.total || 0);
    return {
      campaignDurationHours: Math.round(velocity.bounds.totalHours),
      target,
      ambassadorCount: ambassadors.length,
      activeAmbassadorRate: ambassadors.length ? ambassadors.filter((item) => item.hasStarted).length / ambassadors.length : 0,
      donationCount: rows.length,
      averageDonation: rows.length ? total / rows.length : 0,
      fundraisingVelocity: velocity.campaignAverage.amountPerHour,
      targetPctByElapsedTime: target > 0 ? total / target : 0,
      averageAmbassadorPerformance: ambassadors.length ? total / ambassadors.length : 0,
      inactivityCount: ambassadors.filter((item) => item.status === "Inactive").length,
      completionCurve: velocity.bounds.elapsedRatio,
    };
  }

  return {
    buildVelocityModel,
    buildAmbassadorModels,
    buildForecastModel,
    buildHealthModel,
    buildPriorityList,
    buildAttentionNow,
    buildFingerprint,
    getCampaignBounds,
  };
}
