package dev.lumiere.ftc;

import static com.pedropathing.api.Paths.curve;
import static com.pedropathing.api.Paths.line;
import static com.pedropathing.api.Paths.path;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;

import org.junit.Test;

public class HeadingsTest {
    private static final double EPSILON = 1e-6;
    private final Pose start = new Pose(0, 0, 0);
    private final Pose end = new Pose(48, 0, Math.PI / 2);

    /**
     * Canary for the upstream defect this class works around. When a Pedro Pathing update fixes
     * {@code Curve.pathCompletion}, this test fails: remove it, keep the helper, and update the notes
     * in docs/compatibility.md.
     */
    @Test
    public void pedroLinearHeadingIsReversedOnLinesInThisVersion() {
        Path path = line(start, end).linear(start, end);
        assertEquals(Math.PI / 2, path.heading(0), EPSILON);
        assertEquals(0, path.heading(1), EPSILON);
    }

    @Test
    public void turnsTheIntendedWayOnALine() {
        Path path = line(start, end).heading(Headings.linear(start, end));
        assertEquals(0, path.heading(0), EPSILON);
        assertEquals(Math.PI / 4, path.heading(0.5), EPSILON);
        assertEquals(Math.PI / 2, path.heading(1), EPSILON);
        assertEquals(Math.PI / 2, path.getSegments().get(0).endPose().heading(), EPSILON);
    }

    @Test
    public void matchesPedroOnCurves() {
        Path pedro = curve(start, new Pose(24, 24), end).linear(start, end);
        Path helper = curve(start, new Pose(24, 24), end).heading(Headings.linear(start, end));
        for (double t = 0; t <= 1.0; t += 0.125) {
            assertEquals("t=" + t, pedro.heading(t), helper.heading(t), 1e-4);
        }
    }

    @Test
    public void worksAcrossACompoundPath() {
        Pose middle = new Pose(24, 0, 0);
        Path compound = path(line(start, middle), line(middle, end)).heading(Headings.linear(start, end));
        assertEquals(0, compound.heading(0), EPSILON);
        assertEquals(Math.PI / 2, compound.heading(1), EPSILON);
        assertEquals(Math.PI / 4, compound.heading(0.5), 1e-3);
    }

    @Test
    public void takesTheShortWayAroundZero() {
        Pose from = new Pose(0, 0, Math.toRadians(350));
        Pose to = new Pose(10, 0, Math.toRadians(10));
        Path path = line(from, to).heading(Headings.linear(from, to));
        assertEquals(0, Math.toDegrees(path.heading(0.5)) % 360, 1e-6);
    }

    @Test
    public void linearUntilHoldsTheEndHeadingAfterTheTurn() {
        Path path = line(start, end).heading(Headings.linearUntil(start, end, 0.5));
        assertEquals(Math.PI / 4, path.heading(0.25), EPSILON);
        assertEquals(Math.PI / 2, path.heading(0.5), EPSILON);
        assertEquals(Math.PI / 2, path.heading(0.9), EPSILON);
        assertThrows(IllegalArgumentException.class, () -> Headings.linearUntil(start, end, 0));
        assertThrows(IllegalArgumentException.class, () -> Headings.linearUntil(start, end, 1.5));
    }
}
