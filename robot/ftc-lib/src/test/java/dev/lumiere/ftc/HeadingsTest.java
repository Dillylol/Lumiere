package dev.lumiere.ftc;

import static com.pedropathing.api.Paths.curve;
import static com.pedropathing.api.Paths.line;
import static com.pedropathing.api.Paths.path;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;
import com.pedropathing.utils.Angle;

import org.junit.Test;

public class HeadingsTest {
    private static final double EPSILON = 1e-6;
    private final Pose start = new Pose(0, 0, 0);
    private final Pose end = new Pose(48, 0, Math.PI / 2);

    @Test
    public void reverseTangentUsesTheCurveParameter() {
        Pose control = new Pose(4, 30);
        Path forward = curve(start, control, end).tangent();
        Path reverse = curve(start, control, end).heading(Headings.piecewise().tangent(0, 1, true).build());
        for (double t = 0; t <= 1.0; t += 0.125) {
            double angleBetween = Angle.error(forward.heading(t), reverse.heading(t));
            assertEquals("t=" + t, Math.PI, Math.abs(angleBetween), EPSILON);
        }
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

    /**
     * Pedro Pathing 3.0.2 passes the curve parameter only to interpolators whose {@code isGeometric()}
     * returns true. Reflection lets this test check the same contract on earlier versions, where
     * Interpolator does not yet declare the method.
     */
    @Test
    public void everyInterpolatorAsksForTheCurveParameter() throws Exception {
        com.pedropathing.paths.interpolator.Interpolator[] interpolators = {
                Headings.linear(start, end),
                Headings.linearUntil(start, end, 0.5),
                Headings.piecewise().tangent(0, 0.5, false).facingPoint(0.5, 1, 72, 72).build(),
                Headings.linear(start, end).reverse(),
                Headings.piecewise().constant(0, 1, 0).build().reverse(),
        };
        for (com.pedropathing.paths.interpolator.Interpolator interpolator : interpolators) {
            java.lang.reflect.Method method = interpolator.getClass().getMethod("isGeometric");
            assertEquals(boolean.class, method.getReturnType());
            assertEquals(interpolator.getClass().getName(), Boolean.TRUE, method.invoke(interpolator));
        }
    }

    @Test
    public void reverseFacesTheOtherWay() {
        Path path = line(start, end).heading(Headings.linear(start, end).reverse());
        assertEquals(Math.PI / 4 + Math.PI, path.heading(0.5) < 0 ? path.heading(0.5) + 2 * Math.PI : path.heading(0.5), EPSILON);
    }
}
